#!/usr/bin/env python3
"""
add-fleet-faq.py - render fleet.html's FAQPage schema as a *visible* FAQ.

fleet.html already ships a schema.org FAQPage JSON-LD block (4 Q&As about the
free agent, the control plane, compliance rollups, and Pro pricing), but the page
has no visible FAQ on it. Google's FAQ structured-data policy requires the
marked-up Q&A to be visible to users on the page - schema-only FAQ is ignored
(and can be flagged as a structured-data mismatch in Search Console).

This script closes that gap by reading the EXISTING FAQPage JSON-LD already in the
page and generating a visible <details>/<summary> accordion whose text mirrors it
1:1. The JSON-LD stays the single source of truth, so the visible content can
never drift from the schema. Styled to match fleet.html's dark palette
(ink/slate Tailwind tokens defined inline in the page).

Design notes
------------
- Source of truth = the FAQPage JSON-LD that's already live in fleet.html. We do
  NOT hard-code the questions here; we parse them out, so editing the schema
  updates the visible accordion on the next run.
- Idempotent: a page already carrying the visible marker is skipped (or, with
  --check, reported). Safe to re-run.
- The visible section is inserted right before the footer mount
  (<div id="site-footer">), matching where add-vs-faq.py puts its section.

Usage:
    python scripts/add-fleet-faq.py            # inject the visible FAQ into fleet.html
    python scripts/add-fleet-faq.py --check     # exit 1 if fleet.html lacks the visible FAQ
"""
from __future__ import annotations

import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / "fleet.html"

SECTION_MARKER = "<!-- fleet-faq:start -->"
SECTION_END = "<!-- fleet-faq:end -->"
LD_MARKER = '"@type": "FAQPage"'


def extract_faqpage(html_text: str) -> list[tuple[str, str]]:
    """Pull (question, answer) pairs out of the page's FAQPage JSON-LD block.

    Returns [] if no FAQPage block is present or it cannot be parsed.
    """
    for m in re.finditer(
        r'<script type="application/ld\+json">\s*(\{.*?\})\s*</script>',
        html_text,
        re.DOTALL,
    ):
        raw = m.group(1)
        if LD_MARKER not in raw:
            continue
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if data.get("@type") != "FAQPage":
            continue
        pairs: list[tuple[str, str]] = []
        for entity in data.get("mainEntity", []):
            q = (entity.get("name") or "").strip()
            ans = entity.get("acceptedAnswer") or {}
            a = (ans.get("text") or "").strip()
            if q and a:
                pairs.append((q, a))
        return pairs
    return []


def render_visible(faqs: list[tuple[str, str]]) -> str:
    items = []
    for q, a in faqs:
        # q/a come straight from JSON-LD (already plain text); escape for HTML so
        # the visible text equals the schema text exactly.
        items.append(
            f'''        <details class="group border border-white/10 rounded-lg bg-ink-800/40 px-5 py-4">
          <summary class="flex cursor-pointer items-center justify-between text-white font-medium list-none">
            <span>{html.escape(q)}</span>
            <span class="ml-4 text-slate-500 transition-transform group-open:rotate-45">+</span>
          </summary>
          <p class="mt-3 text-sm text-slate-400 leading-relaxed">{html.escape(a)}</p>
        </details>'''
        )
    body = "\n".join(items)
    return f'''{SECTION_MARKER}
<section class="border-t border-white/5 bg-ink-900/30">
  <div class="max-w-3xl mx-auto px-6 py-16">
    <h2 class="text-2xl font-bold text-white text-center mb-3">Fleet management FAQ</h2>
    <p class="text-slate-400 text-center mb-8">Free runs anywhere; Pro adds the control plane.</p>
    <div class="space-y-3">
{body}
    </div>
  </div>
</section>
{SECTION_END}
'''


def inject(path: Path) -> str:
    html_text = path.read_text(encoding="utf-8")
    if SECTION_MARKER in html_text:
        return "already has visible FAQ"

    faqs = extract_faqpage(html_text)
    if not faqs:
        return "ERROR: no FAQPage JSON-LD to mirror"

    visible = render_visible(faqs)
    if '<div id="site-footer">' in html_text:
        html_text = html_text.replace(
            '<div id="site-footer">', visible + "\n<div id=\"site-footer\">", 1
        )
    elif "</body>" in html_text:
        html_text = html_text.replace("</body>", visible + "\n</body>", 1)
    else:
        return "ERROR: no footer mount or </body>"

    path.write_text(html_text, encoding="utf-8")
    return f"injected {len(faqs)} Q&As (mirrors JSON-LD)"


def main(argv: list[str]) -> int:
    check_only = "--check" in argv
    if not PAGE.exists():
        print(f"ERROR: {PAGE} not found", file=sys.stderr)
        return 1

    text = PAGE.read_text(encoding="utf-8")
    has_schema = LD_MARKER in text
    has_visible = SECTION_MARKER in text

    if check_only:
        if has_schema and not has_visible:
            print(f"  FAIL {PAGE.name}: FAQPage schema present but no visible FAQ")
            return 1
        if not has_schema:
            print(f"  --   {PAGE.name}: no FAQPage schema (nothing to mirror)")
            return 0
        # Verify the visible accordion still matches the schema 1:1.
        faqs = extract_faqpage(text)
        missing = [q for q, _ in faqs if html.escape(q) not in text]
        if missing:
            print(f"  FAIL {PAGE.name}: visible FAQ out of sync ({len(missing)} question(s) missing)")
            return 1
        print(f"  OK   {PAGE.name}: visible FAQ mirrors {len(faqs)} schema Q&As")
        return 0

    print(f"  {PAGE.name}: {inject(PAGE)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
