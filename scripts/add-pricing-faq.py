#!/usr/bin/env python3
"""
add-pricing-faq.py - add FAQPage JSON-LD to the pricing page.

/pricing is the highest commercial-intent page on the site and it already
carries a rich, 7-question visible "Pricing FAQ" section - but, unlike every
/vs/* comparison page and /fleet, it shipped *without* a schema.org FAQPage
block. That means it is not eligible for FAQ rich-results or clean extraction
into AI answer engines, even though the content is right there on the page.

This injects a matching FAQPage JSON-LD block into <head>.

Single source of truth
----------------------
Google requires FAQ structured data to mirror content that is *visible* on the
page. To make drift impossible, this script does NOT hardcode the Q&As - it
*parses them out of the visible "Pricing FAQ" <section>* in pricing.html and
generates the JSON-LD from exactly that text (with inline tags stripped). Edit
the visible FAQ and re-run; the structured data follows automatically.

This mirrors the convention already used by add-vs-faq.py and add-fleet-faq.py
(visible accordion + matching FAQPage generated from the same source).

Idempotent: a page already carrying the FAQPage marker is skipped, so this is
safe to re-run.

Usage:
    python scripts/add-pricing-faq.py            # inject JSON-LD into pricing.html
    python scripts/add-pricing-faq.py --check    # exit 1 if pricing.html lacks it
"""
from __future__ import annotations

import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PRICING = ROOT / "pricing.html"

# Marker so we can detect / avoid double-injection (same token add-vs-faq.py uses).
LD_MARKER = '"@type": "FAQPage"'

# The visible FAQ lives in the section introduced by this comment in pricing.html.
FAQ_SECTION_RE = re.compile(
    r"<!--\s*FAQ\s*-->\s*<section\b.*?</section>",
    re.IGNORECASE | re.DOTALL,
)
# Each Q&A is an <h3>question</h3> immediately followed by a <p>answer</p>.
QA_RE = re.compile(
    r"<h3[^>]*>(?P<q>.*?)</h3>\s*<p[^>]*>(?P<a>.*?)</p>",
    re.IGNORECASE | re.DOTALL,
)


def strip_tags(s: str) -> str:
    """Plain text for JSON-LD (visible text minus inline tags, whitespace collapsed)."""
    # Unescape entities first so the JSON value carries real characters
    # (e.g. "—", "<") rather than "&mdash;" / "&lt;".
    text = re.sub(r"<[^>]+>", "", s)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def extract_faqs(html_text: str) -> list[tuple[str, str]]:
    """Pull (question, answer) pairs out of the visible Pricing FAQ section."""
    section = FAQ_SECTION_RE.search(html_text)
    if not section:
        raise ValueError("could not locate the visible '<!-- FAQ -->' section")
    faqs: list[tuple[str, str]] = []
    for m in QA_RE.finditer(section.group(0)):
        q = strip_tags(m.group("q"))
        a = strip_tags(m.group("a"))
        if q and a:
            faqs.append((q, a))
    return faqs


def render_ldjson(faqs: list[tuple[str, str]]) -> str:
    data = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
            {
                "@type": "Question",
                "name": q,
                "acceptedAnswer": {"@type": "Answer", "text": a},
            }
            for q, a in faqs
        ],
    }
    inner = json.dumps(data, indent=2, ensure_ascii=False)
    return f"  <script type=\"application/ld+json\">\n{inner}\n  </script>\n"


def inject(path: Path) -> str:
    html_text = path.read_text(encoding="utf-8")
    if LD_MARKER in html_text:
        return "already has FAQPage"

    faqs = extract_faqs(html_text)
    if not faqs:
        return "ERROR: no Q&As found in visible FAQ section"

    ld = render_ldjson(faqs)
    if "</head>" not in html_text:
        return "ERROR: no </head>"
    html_text = html_text.replace("</head>", ld + "</head>", 1)
    path.write_text(html_text, encoding="utf-8")
    return f"injected FAQPage with {len(faqs)} Q&As"


def main(argv: list[str]) -> int:
    check_only = "--check" in argv
    if not PRICING.exists():
        print(f"ERROR: {PRICING} not found", file=sys.stderr)
        return 1

    text = PRICING.read_text(encoding="utf-8")
    has = LD_MARKER in text

    if check_only:
        if has:
            print(f"  OK   {PRICING.name}: FAQPage present")
            return 0
        print(f"  FAIL {PRICING.name}: MISSING FAQPage", file=sys.stderr)
        return 1

    print(f"  {PRICING.name}: {inject(PRICING)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
