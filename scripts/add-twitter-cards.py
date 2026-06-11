#!/usr/bin/env python3
"""Add missing Twitter Card meta tags (twitter:image, twitter:title,
twitter:description) to every public HTML page.

Every page already declares <meta name="twitter:card" content="summary_large_image">
and a full Open Graph block. When a page omits twitter:image / twitter:title /
twitter:description, X/Twitter cannot reliably render the large-image card
(twitter:image in particular is required for the image to show). This script
fills the gaps by mirroring the page's existing og:image / og:title /
og:description values, inserting the tags immediately after the twitter:card
line so they sit with the rest of the social metadata.

Idempotent: a tag that already exists is left untouched, so re-running makes no
changes. Run from the repo root:

    python scripts/add-twitter-cards.py            # apply
    python scripts/add-twitter-cards.py --check    # report only, non-zero if work remains
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Directories that are not standalone pages.
SKIP_DIRS = {"components", "og", "workers", "node_modules", ".git", "scripts"}

OG_RE = {
    "image": re.compile(r'<meta\s+property=["\']og:image["\']\s+content=["\'](?P<v>[^"\']*)["\']', re.I),
    "title": re.compile(r'<meta\s+property=["\']og:title["\']\s+content=["\'](?P<v>[^"\']*)["\']', re.I),
    "description": re.compile(r'<meta\s+property=["\']og:description["\']\s+content=["\'](?P<v>[^"\']*)["\']', re.I),
}
TW_PRESENT = {
    "image": re.compile(r'<meta\s+name=["\']twitter:image["\']', re.I),
    "title": re.compile(r'<meta\s+name=["\']twitter:title["\']', re.I),
    "description": re.compile(r'<meta\s+name=["\']twitter:description["\']', re.I),
}
TW_CARD_RE = re.compile(r'^(?P<indent>[ \t]*)<meta\s+name=["\']twitter:card["\'][^>]*>\s*$', re.I | re.M)


def html_pages() -> list[Path]:
    pages: list[Path] = []
    for p in ROOT.rglob("*.html"):
        if any(part in SKIP_DIRS for part in p.relative_to(ROOT).parts[:-1]):
            continue
        pages.append(p)
    return sorted(pages)


def attr_escape(value: str) -> str:
    # og:* values are already HTML-attribute-escaped in source; mirror verbatim.
    return value


def process(path: Path, apply: bool) -> list[str]:
    """Return the list of twitter:* keys that were (or would be) added."""
    text = path.read_text(encoding="utf-8")

    card = TW_CARD_RE.search(text)
    if not card:
        # No twitter:card anchor -> leave the page alone (don't guess placement).
        return []

    og_vals = {}
    for key, rx in OG_RE.items():
        m = rx.search(text)
        if m:
            og_vals[key] = m.group("v")

    indent = card.group("indent")
    additions: list[str] = []
    new_lines: list[str] = []

    # Order: image, title, description (image first since it's the required one).
    for key in ("image", "title", "description"):
        if TW_PRESENT[key].search(text):
            continue  # already present -> idempotent skip
        if key not in og_vals:
            continue  # nothing to mirror from
        additions.append(key)
        new_lines.append(
            f'{indent}<meta name="twitter:{key}" content="{attr_escape(og_vals[key])}" />'
        )

    if not additions:
        return []

    if apply:
        insert_at = card.end()
        injected = "\n" + "\n".join(new_lines)
        text = text[:insert_at] + injected + text[insert_at:]
        path.write_text(text, encoding="utf-8")

    return additions


def main() -> int:
    check = "--check" in sys.argv
    pages = html_pages()
    total_added = 0
    touched = 0

    for page in pages:
        added = process(page, apply=not check)
        rel = page.relative_to(ROOT).as_posix()
        if added:
            touched += 1
            total_added += len(added)
            verb = "would add" if check else "added"
            print(f"  {rel}: {verb} {', '.join('twitter:' + a for a in added)}")
        else:
            print(f"  {rel}: ok")

    print()
    if check:
        if total_added:
            print(f"{total_added} missing twitter tag(s) across {touched} page(s).")
            return 1
        print(f"All {len(pages)} pages have complete Twitter Card metadata.")
        return 0

    print(f"Done. Added {total_added} twitter tag(s) across {touched} of {len(pages)} page(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
