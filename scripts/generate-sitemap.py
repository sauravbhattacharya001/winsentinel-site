#!/usr/bin/env python3
"""
generate-sitemap.py - generate (or verify) sitemap.xml from the pages on disk.

The single source of truth for a page's public URL is its own
``<link rel="canonical">`` tag (already required + validated by check-seo.py).
This script discovers every public-facing HTML file, reads its canonical URL,
and emits one ``<url>`` entry per page - so the sitemap can never silently
drift out of sync with the actual pages (add a page, run this, done).

``lastmod`` is the date of the last git commit that touched the file, so it is
accurate and automatic instead of a hand-maintained date that goes stale.

Usage::

    python scripts/generate-sitemap.py            # write sitemap.xml
    python scripts/generate-sitemap.py --check     # CI: fail if out of sync

Exit codes:
    0  sitemap written, or (with --check) already in sync
    1  (with --check) sitemap.xml is missing / stale / missing a page
"""
from __future__ import annotations

import re
import subprocess
import sys
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITEMAP = ROOT / "sitemap.xml"
SITE_ORIGIN = "https://winsentinel.ai"

CANONICAL_RE = re.compile(r'<link\s+rel="canonical"\s+href="([^"]+)"')


def discover_pages() -> list[Path]:
    """All public-facing HTML files (excludes component/partial fragments)."""
    pages: list[Path] = [
        ROOT / "index.html",
        ROOT / "modules.html",
        ROOT / "pricing.html",
        ROOT / "fleet.html",
        ROOT / "fleet" / "setup.html",
        ROOT / "docs" / "rbac.html",
        ROOT / "blog.html",
        ROOT / "changelog.html",
        ROOT / "buy.html",
        ROOT / "portal.html",
        *sorted(p for p in ROOT.joinpath("blog").glob("*.html") if not p.name.startswith("_")),
        *sorted(ROOT.joinpath("vs").glob("*.html")),
    ]
    return [p for p in pages if p.exists()]


def canonical_of(path: Path) -> str | None:
    m = CANONICAL_RE.search(path.read_text(encoding="utf-8"))
    return m.group(1) if m else None


def git_lastmod(path: Path) -> str:
    """ISO date (YYYY-MM-DD) of the last commit touching ``path``.

    Falls back to the file mtime, then today, if git history is unavailable
    (e.g. an uncommitted new page or a shallow clone with no log for it).
    """
    try:
        out = subprocess.run(
            ["git", "log", "-1", "--format=%cs", "--", str(path)],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            check=False,
        )
        stamp = out.stdout.strip()
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", stamp):
            return stamp
    except Exception:
        pass
    try:
        return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).date().isoformat()
    except Exception:
        return date.today().isoformat()


def priority_and_freq(url_path: str) -> tuple[str, str]:
    """Assign a priority + changefreq from the URL path. Kept simple + stable."""
    if url_path == "/":
        return "1.0", "weekly"
    if url_path in ("/pricing", "/fleet"):
        return "0.9", "monthly"
    if url_path == "/modules":
        return "0.8", "monthly"
    if url_path in ("/blog", "/changelog"):
        return "0.8", "weekly"
    if url_path.startswith("/blog/"):
        return "0.7", "monthly"
    if url_path.startswith("/vs/"):
        return "0.8", "monthly"
    if url_path in ("/buy", "/portal"):
        return "0.7", "monthly"
    if url_path.startswith("/docs/") or url_path.startswith("/fleet/"):
        return "0.7", "monthly"
    return "0.6", "monthly"


def build_entries() -> list[dict]:
    entries: list[dict] = []
    seen: set[str] = set()
    for page in discover_pages():
        loc = canonical_of(page)
        if not loc:
            raise SystemExit(
                f"ERROR: {page.relative_to(ROOT).as_posix()} has no <link rel=\"canonical\"> - "
                f"cannot place it in the sitemap. Add a canonical tag first."
            )
        if loc in seen:
            continue
        seen.add(loc)
        url_path = loc[len(SITE_ORIGIN):] if loc.startswith(SITE_ORIGIN) else loc
        if url_path == "":
            url_path = "/"
        prio, freq = priority_and_freq(url_path)
        entries.append(
            {"loc": loc, "lastmod": git_lastmod(page), "changefreq": freq, "priority": prio}
        )
    # Stable, human-friendly order: homepage first, then by priority desc, then loc.
    entries.sort(key=lambda e: (e["loc"] != f"{SITE_ORIGIN}/", -float(e["priority"]), e["loc"]))
    return entries


def render(entries: list[dict]) -> str:
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ]
    for e in entries:
        lines.append("  <url>")
        lines.append(f"    <loc>{e['loc']}</loc>")
        lines.append(f"    <lastmod>{e['lastmod']}</lastmod>")
        lines.append(f"    <changefreq>{e['changefreq']}</changefreq>")
        lines.append(f"    <priority>{e['priority']}</priority>")
        lines.append("  </url>")
    lines.append("</urlset>")
    return "\n".join(lines) + "\n"


def existing_locs() -> set[str]:
    if not SITEMAP.exists():
        return set()
    return set(re.findall(r"<loc>([^<]+)</loc>", SITEMAP.read_text(encoding="utf-8")))


def main(argv: list[str]) -> int:
    check_only = "--check" in argv
    entries = build_entries()
    rendered = render(entries)

    if check_only:
        want_locs = {e["loc"] for e in entries}
        have_locs = existing_locs()
        # Hard failures: the URL SET is wrong (a page is missing, or a stale
        # entry points at a page that no longer exists). This is the drift that
        # actually breaks crawling / leaves dead URLs, and it is independent of
        # git history depth, so it is safe to fail CI on.
        hard: list[str] = []
        if not SITEMAP.exists():
            hard.append("sitemap.xml does not exist")
        else:
            for loc in sorted(want_locs - have_locs):
                hard.append(f"page missing from sitemap: {loc}")
            for loc in sorted(have_locs - want_locs):
                hard.append(f"stale entry in sitemap (no such page): {loc}")

        if hard:
            print("Sitemap out of sync:", file=sys.stderr)
            for p in hard:
                print(f"  - {p}", file=sys.stderr)
            print("\nRun: python scripts/generate-sitemap.py", file=sys.stderr)
            return 1

        # Soft note: lastmod/order differs from a fresh render. We do NOT fail on
        # this - a shallow CI checkout (actions/checkout default) makes
        # `git log` report the HEAD date for every file, so the rendered
        # lastmod legitimately differs from the committed dates. Surface it as a
        # nudge to regenerate locally, where git history is complete.
        if SITEMAP.exists() and SITEMAP.read_text(encoding="utf-8") != rendered:
            print(f"sitemap.xml URL set is in sync ({len(entries)} URLs); "
                  f"lastmod/order may be stale - run generate-sitemap.py locally to refresh.")
            return 0
        print(f"sitemap.xml is in sync ({len(entries)} URLs).")
        return 0

    SITEMAP.write_text(rendered, encoding="utf-8")
    print(f"Wrote {SITEMAP.relative_to(ROOT).as_posix()} with {len(entries)} URLs.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
