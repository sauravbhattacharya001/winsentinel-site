#!/usr/bin/env python3
"""
add-blog-breadcrumbs.py — add BreadcrumbList JSON-LD to every blog post.

Every other section of the site (/vs/*, /docs/*, /buy, /portal, /pricing,
/fleet, /fleet/setup) emits a schema.org BreadcrumbList so Google can render
breadcrumb rich results in search. The 23 blog posts — the largest content
category — only carried BlogPosting, so they were the one section ineligible
for breadcrumb display. This brings them to parity.

The breadcrumb is Home › Blog › <post>, where the leaf name and URL are read
from the post's EXISTING BlogPosting block (headline + url/@id/mainEntityOfPage)
so the JSON-LD stays the single source of truth and the breadcrumb can't drift
from the canonical title/URL.

Insertion: a new <script type="application/ld+json"> block placed immediately
after the BlogPosting block's closing </script>, matching its indentation.

Usage:
    python scripts/add-blog-breadcrumbs.py          # inject (idempotent)
    python scripts/add-blog-breadcrumbs.py --check   # verify, exit 1 on drift

Idempotent: a post that already has a BreadcrumbList is left untouched.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BLOG_DIR = ROOT / "blog"
SITE = "https://winsentinel.ai"

# Match every ld+json block, keeping the leading indentation of the <script>
# line and the raw JSON payload so we can both inspect types and mirror layout.
LDJSON_BLOCK = re.compile(
    r'(?P<indent>[ \t]*)<script type="application/ld\+json">\s*(?P<json>.*?)\s*</script>',
    flags=re.DOTALL,
)


def parsed_blocks(html: str):
    """Yield (match, dict) for each valid ld+json object block."""
    for m in LDJSON_BLOCK.finditer(html):
        try:
            data = json.loads(m.group("json"))
        except json.JSONDecodeError:
            continue
        yield m, data


def has_breadcrumb(html: str) -> bool:
    for _, data in parsed_blocks(html):
        items = data if isinstance(data, list) else [data]
        if any(isinstance(it, dict) and it.get("@type") == "BreadcrumbList" for it in items):
            return True
    return False


def find_blogposting(html: str):
    """Return (match, dict) for the BlogPosting block, or (None, None)."""
    for m, data in parsed_blocks(html):
        if isinstance(data, dict) and data.get("@type") == "BlogPosting":
            return m, data
    return None, None


def leaf_url(post: dict) -> str | None:
    """Canonical post URL from the BlogPosting block (url > @id > mainEntityOfPage)."""
    for key in ("url", "@id", "mainEntityOfPage"):
        val = post.get(key)
        if isinstance(val, str) and val.startswith("http"):
            return val
        if isinstance(val, dict) and isinstance(val.get("@id"), str):
            return val["@id"]
    return None


def build_breadcrumb(post: dict) -> dict:
    name = (post.get("headline") or "").strip()
    url = leaf_url(post)
    leaf = {"@type": "ListItem", "position": 3, "name": name}
    if url:
        leaf["item"] = url
    return {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": f"{SITE}/"},
            {"@type": "ListItem", "position": 2, "name": "Blog", "item": f"{SITE}/blog"},
            leaf,
        ],
    }


def render_block(crumb: dict, indent: str) -> str:
    """A <script> block whose inner JSON is indented one level past `indent`."""
    body = json.dumps(crumb, indent=2, ensure_ascii=False)
    body = "\n".join((indent + "  " + line) if line else line for line in body.splitlines())
    return f'{indent}<script type="application/ld+json">\n{body}\n{indent}</script>'


def inject(path: Path) -> str:
    """Return 'added', 'exists', 'no-blogposting', or 'invalid-headline'."""
    html = path.read_text(encoding="utf-8")
    if has_breadcrumb(html):
        return "exists"
    m, post = find_blogposting(html)
    if not m:
        return "no-blogposting"
    if not (post.get("headline") or "").strip():
        return "invalid-headline"

    crumb = build_breadcrumb(post)
    indent = m.group("indent")
    block = render_block(crumb, indent)
    # Insert immediately after the BlogPosting block's closing </script>.
    insert_at = m.end()
    new_html = html[:insert_at] + "\n" + block + html[insert_at:]
    path.write_text(new_html, encoding="utf-8")
    return "added"


def check(path: Path) -> list[str]:
    """Validate breadcrumb presence + correctness against the BlogPosting block."""
    html = path.read_text(encoding="utf-8")
    problems: list[str] = []

    crumb = None
    for _, data in parsed_blocks(html):
        items = data if isinstance(data, list) else [data]
        for it in items:
            if isinstance(it, dict) and it.get("@type") == "BreadcrumbList":
                crumb = it
    if crumb is None:
        return ["missing BreadcrumbList"]

    items = crumb.get("itemListElement", [])
    if len(items) != 3:
        problems.append(f"expected 3 breadcrumb items, found {len(items)}")
    names = [i.get("name") for i in items]
    if names[:2] != ["Home", "Blog"]:
        problems.append(f"first two crumbs must be Home, Blog (got {names[:2]})")
    # positions must be 1,2,3 in order
    if [i.get("position") for i in items] != [1, 2, 3]:
        problems.append("breadcrumb positions must be 1,2,3 in order")

    # Leaf must match the BlogPosting headline + canonical URL (no drift).
    _, post = find_blogposting(html)
    if post and items:
        leaf = items[-1]
        if leaf.get("name") != (post.get("headline") or "").strip():
            problems.append("leaf breadcrumb name does not match BlogPosting headline")
        want_url = leaf_url(post)
        if want_url and leaf.get("item") != want_url:
            problems.append("leaf breadcrumb item does not match BlogPosting URL")
    return problems


def main() -> int:
    check_mode = "--check" in sys.argv
    posts = sorted(p for p in BLOG_DIR.glob("*.html") if not p.name.startswith("_"))
    if not posts:
        print("no blog posts found", file=sys.stderr)
        return 1

    if check_mode:
        failed = 0
        for p in posts:
            problems = check(p)
            rel = p.relative_to(ROOT).as_posix()
            if problems:
                failed += 1
                print(f"FAIL {rel}")
                for pr in problems:
                    print(f"     - {pr}")
            else:
                print(f"OK   {rel}")
        if failed:
            print(f"\n{failed} post(s) missing/!= breadcrumb", file=sys.stderr)
            return 1
        print(f"\nAll {len(posts)} blog posts have a valid BreadcrumbList.")
        return 0

    added = exists = skipped = 0
    for p in posts:
        result = inject(p)
        rel = p.relative_to(ROOT).as_posix()
        if result == "added":
            added += 1
            print(f"ADD  {rel}")
        elif result == "exists":
            exists += 1
            print(f"skip {rel} (already has breadcrumb)")
        else:
            skipped += 1
            print(f"WARN {rel}: {result}")
    print(f"\nadded={added} exists={exists} skipped={skipped}")
    return 1 if skipped else 0


if __name__ == "__main__":
    sys.exit(main())
