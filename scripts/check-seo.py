#!/usr/bin/env python3
"""
check-seo.py — sanity check SEO basics on every public-facing HTML page.

Usage:
    python scripts/check-seo.py

Verifies for each page:
  - <link rel="canonical">
  - <meta property="og:title">
  - <meta property="og:description">
  - <meta property="og:image">
  - <meta name="twitter:card">
  - At least one <script type="application/ld+json"> block, with valid JSON
  - The og:image asset actually exists on disk (catches broken preview images)

Exits 0 on success, 1 if any page is missing required tags or has invalid JSON-LD.
This is run manually before publishing schema or sitemap changes.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Pages that are public-facing and SEO-relevant.
PAGES = sorted(
    [
        ROOT / "index.html",
        ROOT / "pricing.html",
        ROOT / "fleet.html",
        ROOT / "fleet" / "setup.html",
        ROOT / "docs" / "rbac.html",
        ROOT / "blog.html",
        ROOT / "changelog.html",
        ROOT / "buy.html",
        ROOT / "portal.html",
        *ROOT.joinpath("vs").glob("*.html"),
    ]
)

REQUIRED_TAGS = [
    ('canonical', re.compile(r'<link\s+rel="canonical"\s+href="[^"]+"')),
    ('og:title', re.compile(r'<meta\s+property="og:title"\s+content="[^"]+"')),
    ('og:description', re.compile(r'<meta\s+property="og:description"\s+content="[^"]+"')),
    ('og:image', re.compile(r'<meta\s+property="og:image"\s+content="[^"]+"')),
    ('twitter:card', re.compile(r'<meta\s+name="twitter:card"\s+content="[^"]+"')),
]

# Capture the og:image URL so we can verify the referenced asset actually exists
# on disk. A present-but-broken og:image silently breaks every social/link
# preview, and the tag-presence check above would happily pass it.
OG_IMAGE_RE = re.compile(r'<meta\s+property="og:image"\s+content="([^"]+)"')

# Local origin whose absolute URLs map to files in this repo.
SITE_ORIGIN = "https://winsentinel.ai"

LDJSON_RE = re.compile(
    r'<script type="application/ld\+json">\s*(.*?)\s*</script>',
    flags=re.DOTALL,
)


def check(path: Path) -> list[str]:
    """Return a list of failure messages for this page (empty == ok)."""
    failures: list[str] = []
    html = path.read_text(encoding="utf-8")

    for tag, rx in REQUIRED_TAGS:
        if not rx.search(html):
            failures.append(f"missing {tag}")

    # Verify the og:image asset exists on disk when it points at this site.
    m = OG_IMAGE_RE.search(html)
    if m:
        url = m.group(1)
        local = None
        if url.startswith(SITE_ORIGIN):
            local = url[len(SITE_ORIGIN):]
        elif url.startswith("/"):
            local = url
        if local is not None:
            asset = ROOT / local.lstrip("/").split("?", 1)[0].split("#", 1)[0]
            if not asset.exists():
                failures.append(f"og:image asset not found: {asset.relative_to(ROOT).as_posix()}")

    blocks = LDJSON_RE.findall(html)
    if not blocks:
        failures.append("no JSON-LD")
    else:
        for i, block in enumerate(blocks, start=1):
            try:
                json.loads(block)
            except json.JSONDecodeError as exc:
                failures.append(f"invalid JSON-LD #{i}: {exc.msg} at line {exc.lineno}")

    return failures


def main() -> int:
    failed_pages = 0
    for p in PAGES:
        if not p.exists():
            continue
        rel = p.relative_to(ROOT).as_posix()
        failures = check(p)
        if failures:
            failed_pages += 1
            print(f"FAIL {rel}")
            for f in failures:
                print(f"     - {f}")
        else:
            print(f"OK   {rel}")

    if failed_pages:
        print(f"\n{failed_pages} page(s) failed", file=sys.stderr)
        return 1
    print(f"\nAll {len(PAGES)} pages pass SEO checks.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
