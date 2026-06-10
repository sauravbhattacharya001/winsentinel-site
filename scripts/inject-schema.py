#!/usr/bin/env python3
"""
inject-schema.py — adds JSON-LD structured data to WinSentinel marketing pages.

Run from the repo root:
    python scripts/inject-schema.py

Pages handled:
  - blog.html, changelog.html: ItemList of BlogPosting / Release entries
  - vs/*.html: 11 comparison pages — each gets Product + ComparisonReview schema
  - buy.html, portal.html: BreadcrumbList + WebPage schema

Idempotent: if a page already has a JSON-LD block whose @type matches what we
would inject, the script skips that page. Re-running is safe.
"""
from __future__ import annotations

import datetime as dt
import json
import re
import sys
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parent.parent
SITE_URL = "https://winsentinel.ai"
AUTHOR = {"@type": "Person", "name": "Saurav Bhattacharya"}
PUBLISHER = {
    "@type": "Organization",
    "name": "WinSentinel",
    "url": SITE_URL,
    "logo": {
        "@type": "ImageObject",
        "url": f"{SITE_URL}/og/default.svg",
    },
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def parse_date(label: str) -> str:
    """'June 8, 2026' -> '2026-06-08' (ISO)."""
    return dt.datetime.strptime(label.strip(), "%B %d, %Y").date().isoformat()


def html_escape(text: str) -> str:
    """Escape only the chars that would break an inline <script> JSON block."""
    # </script> sequence is the only real risk inside JSON-LD; escape the slash.
    return text.replace("</", "<\\/")


def render_ldjson(data: dict | list) -> str:
    body = json.dumps(data, indent=2, ensure_ascii=False)
    return f'<script type="application/ld+json">\n{html_escape(body)}\n</script>\n'


def already_has_schema(html: str, type_name: str) -> bool:
    """Avoid double-injecting the same @type."""
    # Search inside existing ld+json blocks only.
    for block in re.findall(
        r'<script type="application/ld\+json">(.*?)</script>',
        html,
        flags=re.DOTALL,
    ):
        if f'"@type": "{type_name}"' in block or f'"@type":"{type_name}"' in block:
            return True
        # ItemList is the wrapper — check itemListElement contents too.
        if type_name == "BlogPosting" and '"BlogPosting"' in block:
            return True
    return False


def inject_before_close_head(html: str, snippet: str) -> str:
    """Insert snippet before </head>. Falls back to before <body> if no </head>."""
    if "</head>" in html:
        return html.replace("</head>", snippet + "</head>", 1)
    return html.replace("<body", snippet + "<body", 1)


# ---------------------------------------------------------------------------
# Blog
# ---------------------------------------------------------------------------

ARTICLE_RE = re.compile(
    r'<article id="(?P<slug>[^"]+)"[^>]*>\s*'
    r'<time[^>]*>(?P<date>[^<]+)</time>\s*'
    r'<h2[^>]*>(?P<title>.+?)</h2>\s*'
    r'<p[^>]*>(?P<summary>.+?)</p>',
    flags=re.DOTALL,
)

TAG_STRIP_RE = re.compile(r'<[^>]+>')


def strip_tags(text: str) -> str:
    return TAG_STRIP_RE.sub('', text).strip()


def build_blog_schema(blog_html: str) -> dict:
    """Build an ItemList with each article as a BlogPosting."""
    items = []
    for i, m in enumerate(ARTICLE_RE.finditer(blog_html), start=1):
        slug = m.group("slug")
        title = strip_tags(m.group("title"))
        summary = strip_tags(m.group("summary"))
        try:
            date_iso = parse_date(m.group("date"))
        except ValueError:
            continue

        items.append({
            "@type": "ListItem",
            "position": i,
            "item": {
                "@type": "BlogPosting",
                "@id": f"{SITE_URL}/blog#{slug}",
                "headline": title,
                "datePublished": date_iso,
                "dateModified": date_iso,
                "url": f"{SITE_URL}/blog#{slug}",
                "mainEntityOfPage": f"{SITE_URL}/blog#{slug}",
                "description": summary,
                "author": AUTHOR,
                "publisher": PUBLISHER,
                "image": f"{SITE_URL}/og/blog.svg",
            },
        })

    return {
        "@context": "https://schema.org",
        "@type": "Blog",
        "@id": f"{SITE_URL}/blog",
        "url": f"{SITE_URL}/blog",
        "name": "WinSentinel Blog",
        "description": (
            "Security tips, audit walkthroughs, and product updates for "
            "Windows security professionals."
        ),
        "publisher": PUBLISHER,
        "blogPost": [item["item"] for item in items],
    }


def process_blog(path: Path) -> bool:
    html = path.read_text(encoding="utf-8")
    if already_has_schema(html, "Blog") or already_has_schema(html, "BlogPosting"):
        return False
    schema = build_blog_schema(html)
    if not schema["blogPost"]:
        print(f"  WARN: no articles parsed in {path.name}, skipping", file=sys.stderr)
        return False
    snippet = "  " + render_ldjson(schema)
    html = inject_before_close_head(html, snippet)
    path.write_text(html, encoding="utf-8", newline="\n")
    return True


# ---------------------------------------------------------------------------
# Changelog
# ---------------------------------------------------------------------------

# Each release lives inside <article id="vX.Y.Z">. The h2 contains an inner
# anchor like <a href="#vX.Y.Z">vX.Y.Z — Title</a>, the date is in a sibling
# <span class="text-sm text-slate-400">June 1, 2026</span>, and the summary
# (when present) is the first <p> inside the .prose body.
RELEASE_RE = re.compile(
    r'<article id="(?P<slug>v[0-9][^"]+)"[^>]*>(?P<body>.*?)</article>',
    flags=re.DOTALL,
)
RELEASE_TITLE_RE = re.compile(
    r'<h2[^>]*>\s*<a [^>]*>(?P<title>.+?)</a>\s*</h2>',
    flags=re.DOTALL,
)
RELEASE_DATE_RE = re.compile(
    r'<span class="text-sm text-slate-400"[^>]*>(?P<date>[^<]+)</span>',
)
RELEASE_SUMMARY_RE = re.compile(
    r'<p class="text-slate-300[^"]*"[^>]*>(?P<sum>.+?)</p>',
    flags=re.DOTALL,
)


def build_changelog_schema(html: str) -> dict:
    items = []
    for i, m in enumerate(RELEASE_RE.finditer(html), start=1):
        slug = m.group("slug")
        body = m.group("body")

        title_m = RELEASE_TITLE_RE.search(body)
        title = strip_tags(title_m.group("title")) if title_m else slug

        date_iso = None
        date_m = RELEASE_DATE_RE.search(body)
        if date_m:
            try:
                date_iso = parse_date(date_m.group("date"))
            except ValueError:
                date_iso = None

        summary_m = RELEASE_SUMMARY_RE.search(body)
        summary = strip_tags(summary_m.group("sum")) if summary_m else ""
        if not summary and title:
            summary = title

        item = {
            "@type": "ListItem",
            "position": i,
            "item": {
                "@type": "TechArticle",
                "@id": f"{SITE_URL}/changelog#{slug}",
                "url": f"{SITE_URL}/changelog#{slug}",
                "headline": title or f"WinSentinel {slug}",
                "description": summary[:300] or f"WinSentinel release {slug}",
                "author": AUTHOR,
                "publisher": PUBLISHER,
            },
        }
        if date_iso:
            item["item"]["datePublished"] = date_iso
            item["item"]["dateModified"] = date_iso
        items.append(item)

    return {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "@id": f"{SITE_URL}/changelog",
        "url": f"{SITE_URL}/changelog",
        "name": "WinSentinel Changelog",
        "description": "Every WinSentinel release, what changed, and when.",
        "itemListOrder": "https://schema.org/ItemListOrderDescending",
        "numberOfItems": len(items),
        "itemListElement": items,
    }


def process_changelog(path: Path) -> bool:
    html = path.read_text(encoding="utf-8")
    if already_has_schema(html, "ItemList") or already_has_schema(html, "TechArticle"):
        return False
    schema = build_changelog_schema(html)
    if not schema["itemListElement"]:
        print(f"  WARN: no releases parsed in {path.name}, skipping", file=sys.stderr)
        return False
    snippet = "  " + render_ldjson(schema)
    html = inject_before_close_head(html, snippet)
    path.write_text(html, encoding="utf-8", newline="\n")
    return True


# ---------------------------------------------------------------------------
# Comparison pages (vs/*.html)
# ---------------------------------------------------------------------------

# Friendly competitor names indexed by file slug.
COMPETITORS = {
    "microsoft-defender": ("Microsoft Defender", "Microsoft", "antivirus and EDR"),
    "nessus": ("Nessus", "Tenable", "vulnerability scanner"),
    "crowdstrike": ("CrowdStrike Falcon", "CrowdStrike", "endpoint detection and response"),
    "sentinelone": ("SentinelOne Singularity", "SentinelOne", "endpoint detection and response"),
    "tanium": ("Tanium", "Tanium", "endpoint management platform"),
    "ninjaone": ("NinjaOne", "NinjaOne", "remote monitoring and management"),
    "lansweeper": ("Lansweeper", "Lansweeper", "IT asset management"),
    "qualys": ("Qualys VMDR", "Qualys", "vulnerability management"),
    "rapid7": ("Rapid7 InsightVM", "Rapid7", "vulnerability management"),
    "wazuh": ("Wazuh", "Wazuh", "open-source SIEM"),
    "intune": ("Microsoft Intune", "Microsoft", "device management and MDM"),
}


META_TITLE_RE = re.compile(r'<title>(?P<v>[^<]+)</title>')
META_DESC_RE = re.compile(r'<meta name="description" content="(?P<v>[^"]+)"')


def build_vs_schema(slug: str, html: str) -> list:
    competitor, vendor, category = COMPETITORS[slug]
    title_m = META_TITLE_RE.search(html)
    desc_m = META_DESC_RE.search(html)
    page_title = title_m.group("v").strip() if title_m else f"WinSentinel vs {competitor}"
    page_desc = desc_m.group("v").strip() if desc_m else ""
    page_url = f"{SITE_URL}/vs/{slug}"

    # 1. The main comparison page itself, as a Review/comparison.
    web_page = {
        "@context": "https://schema.org",
        "@type": "WebPage",
        "@id": page_url,
        "url": page_url,
        "name": page_title,
        "description": page_desc,
        "isPartOf": {
            "@type": "WebSite",
            "name": "WinSentinel",
            "url": SITE_URL,
        },
        "primaryImageOfPage": {
            "@type": "ImageObject",
            "url": f"{SITE_URL}/og/vs-{slug}.svg",
        },
        "about": [
            {
                "@type": "SoftwareApplication",
                "name": "WinSentinel",
                "applicationCategory": "SecurityApplication",
                "operatingSystem": "Windows 10, Windows 11",
                "url": SITE_URL,
            },
            {
                "@type": "SoftwareApplication",
                "name": competitor,
                "applicationCategory": "SecurityApplication",
                "publisher": {"@type": "Organization", "name": vendor},
            },
        ],
        "publisher": PUBLISHER,
        "author": AUTHOR,
    }

    # 2. Breadcrumb so search results show "Home > Compare > vs <vendor>".
    breadcrumb = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": SITE_URL + "/"},
            {"@type": "ListItem", "position": 2, "name": "Compare", "item": SITE_URL + "/#compare"},
            {"@type": "ListItem", "position": 3, "name": f"vs {competitor}", "item": page_url},
        ],
    }

    return [web_page, breadcrumb]


def process_vs_page(path: Path) -> bool:
    slug = path.stem
    if slug not in COMPETITORS:
        print(f"  SKIP unknown competitor: {slug}")
        return False
    html = path.read_text(encoding="utf-8")
    if already_has_schema(html, "BreadcrumbList") and already_has_schema(html, "WebPage"):
        return False
    snippets = build_vs_schema(slug, html)
    body = "  " + "  ".join(render_ldjson(s) for s in snippets)
    html = inject_before_close_head(html, body)
    path.write_text(html, encoding="utf-8", newline="\n")
    return True


# ---------------------------------------------------------------------------
# Buy + Portal — simple WebPage + BreadcrumbList
# ---------------------------------------------------------------------------

def build_simple_page_schema(slug: str, html: str, label: str) -> list:
    title_m = META_TITLE_RE.search(html)
    desc_m = META_DESC_RE.search(html)
    title = title_m.group("v").strip() if title_m else f"WinSentinel {label}"
    desc = desc_m.group("v").strip() if desc_m else ""
    page_url = f"{SITE_URL}/{slug}"
    web_page = {
        "@context": "https://schema.org",
        "@type": "WebPage",
        "@id": page_url,
        "url": page_url,
        "name": title,
        "description": desc,
        "isPartOf": {"@type": "WebSite", "name": "WinSentinel", "url": SITE_URL},
        "publisher": PUBLISHER,
    }
    breadcrumb = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": SITE_URL + "/"},
            {"@type": "ListItem", "position": 2, "name": label, "item": page_url},
        ],
    }
    return [web_page, breadcrumb]


def process_simple(path: Path, label: str) -> bool:
    slug = path.stem
    html = path.read_text(encoding="utf-8")
    if already_has_schema(html, "BreadcrumbList") and already_has_schema(html, "WebPage"):
        return False
    snippets = build_simple_page_schema(slug, html, label)
    body = "  " + "  ".join(render_ldjson(s) for s in snippets)
    html = inject_before_close_head(html, body)
    path.write_text(html, encoding="utf-8", newline="\n")
    return True


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------

def main() -> int:
    changed = []
    skipped = []

    blog = ROOT / "blog.html"
    if blog.exists():
        if process_blog(blog):
            changed.append(blog.name)
        else:
            skipped.append(blog.name)

    cl = ROOT / "changelog.html"
    if cl.exists():
        if process_changelog(cl):
            changed.append(cl.name)
        else:
            skipped.append(cl.name)

    vs_dir = ROOT / "vs"
    if vs_dir.is_dir():
        for vs_path in sorted(vs_dir.glob("*.html")):
            if process_vs_page(vs_path):
                changed.append(f"vs/{vs_path.name}")
            else:
                skipped.append(f"vs/{vs_path.name}")

    for simple_name, label in (("buy.html", "Buy"), ("portal.html", "Customer portal")):
        p = ROOT / simple_name
        if p.exists():
            if process_simple(p, label):
                changed.append(simple_name)
            else:
                skipped.append(simple_name)

    print(f"Changed ({len(changed)}):")
    for c in changed:
        print(f"  + {c}")
    if skipped:
        print(f"Skipped (already had schema, {len(skipped)}):")
        for s in skipped:
            print(f"  - {s}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
