#!/usr/bin/env python3
"""Inject the Cloudflare Web Analytics loader into every public HTML page.

WinSentinel uses Cloudflare Web Analytics (cookieless, privacy-friendly,
explicitly NOT Google Analytics — see the Site roadmap S9). The beacon needs a
per-site token from the Cloudflare dashboard, which is a human-gated value and
is intentionally NOT committed. This script wires up the *loader* on every page
so that the moment a real token is dropped into js/cf-analytics.js's
configuration (a single edit — see README "Analytics"), the whole site starts
reporting. Until then the loader is a complete no-op (no beacon, no network
request).

Each page gets two lines added immediately before </head>:

    <script>window.__WS_CF_BEACON_TOKEN__ = "__CF_BEACON_TOKEN__";</script>
    <script defer src="/js/cf-analytics.js"></script>

The token starts as the placeholder "__CF_BEACON_TOKEN__"; cf-analytics.js
treats the placeholder (and any empty/missing value) as "not configured" and
stays inert. To go live, replace the placeholder with the real Cloudflare token
on every page (a find-and-replace) — or, simpler, set it once here and re-run.

Idempotent: a page that already references /js/cf-analytics.js is left
untouched, so re-running makes no changes. Line endings are preserved (the repo
keeps HTML as CRLF and has no .gitattributes), so the diff stays minimal.

Usage (from the repo root):

    python scripts/add-analytics.py            # apply
    python scripts/add-analytics.py --check    # report only, non-zero if work remains
    python scripts/add-analytics.py --token "<cloudflare-token>"   # apply with a real token
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Directories that are not standalone, indexable pages.
SKIP_DIRS = {"components", "og", "workers", "node_modules", ".git", "scripts", "js"}

PLACEHOLDER = "__CF_BEACON_TOKEN__"
LOADER_SRC = "/js/cf-analytics.js"

# A page is considered already wired if it references the loader script.
ALREADY_RE = re.compile(re.escape(LOADER_SRC), re.I)
# Anchor: the closing </head>, capturing the leading indentation on its line so
# the injected lines align with the surrounding <head> content.
HEAD_CLOSE_RE = re.compile(r'(?P<indent>[ \t]*)</head>', re.I)


def html_pages() -> list[Path]:
    pages: list[Path] = []
    for p in ROOT.rglob("*.html"):
        if any(part in SKIP_DIRS for part in p.relative_to(ROOT).parts[:-1]):
            continue
        pages.append(p)
    return sorted(pages)


def detect_newline(text: str) -> str:
    """Return the dominant newline style so we write the file back unchanged."""
    crlf = text.count("\r\n")
    lf = text.count("\n") - crlf
    return "\r\n" if crlf >= lf else "\n"


def process(path: Path, token: str, apply: bool) -> bool:
    """Inject the loader if missing. Returns True if the page was (or would be) changed."""
    # newline="" keeps the original CR/LF bytes intact so we can detect + preserve them.
    with path.open("r", encoding="utf-8", newline="") as fh:
        raw = fh.read()
    if ALREADY_RE.search(raw):
        return False  # already wired -> idempotent skip

    m = HEAD_CLOSE_RE.search(raw)
    if not m:
        # No </head> anchor -> don't guess; leave the page alone.
        return False

    nl = detect_newline(raw)
    indent = m.group("indent")
    block = (
        f'{indent}<!-- Cloudflare Web Analytics (cookieless). Token is set out-of-band; loader no-ops until configured. -->{nl}'
        f'{indent}<script>window.__WS_CF_BEACON_TOKEN__ = "{token}";</script>{nl}'
        f'{indent}<script defer src="{LOADER_SRC}"></script>{nl}'
    )

    if apply:
        insert_at = m.start()
        new_text = raw[:insert_at] + block + raw[insert_at:]
        with path.open("w", encoding="utf-8", newline="") as fh:
            fh.write(new_text)

    return True


def main() -> int:
    ap = argparse.ArgumentParser(description="Inject Cloudflare Web Analytics loader into every page.")
    ap.add_argument("--check", action="store_true", help="report only; non-zero exit if work remains")
    ap.add_argument("--token", default=PLACEHOLDER,
                    help="Cloudflare beacon token to embed (default: placeholder, loader stays inert)")
    args = ap.parse_args()

    pages = html_pages()
    touched = 0
    for page in pages:
        changed = process(page, args.token, apply=not args.check)
        rel = page.relative_to(ROOT).as_posix()
        if changed:
            touched += 1
            print(f"  {rel}: {'would add' if args.check else 'added'} Cloudflare Web Analytics loader")
        else:
            print(f"  {rel}: ok")

    print()
    if args.check:
        if touched:
            print(f"{touched} page(s) missing the analytics loader.")
            return 1
        print(f"All {len(pages)} pages have the Cloudflare Web Analytics loader.")
        return 0

    note = "" if args.token != PLACEHOLDER else " (placeholder token — loader stays inert until a real token is set)"
    print(f"Done. Wired {touched} of {len(pages)} page(s){note}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
