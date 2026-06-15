#!/usr/bin/env python3
"""Add a reciprocal "All comparisons" link to every /vs/<competitor> page's
"Compare:" sub-nav, pointing back at the /vs/ hub.

Why: the /vs/ hub (vs/index.html) links out to all 11 competitor comparisons,
but each competitor page only cross-links its *siblings* in the inline
"Compare:" sub-nav - there was no link back up to the hub. That left the
comparison cluster's internal-link graph one-directional: link equity flowed
out of the hub but never back into it, and a visitor on (say) /vs/nessus had no
one-click path to "see all comparisons". Adding the hub link to each page makes
the cluster a proper hub-and-spoke (better SEO distribution + discovery).

Idempotent: inserts the link only if the page doesn't already have one. Safe to
re-run; a second run is a no-op. Use --check (CI) to assert every page already
has the link without modifying anything.

Anchor: the sub-nav is
    <span ...>Compare:</span>
    <a href="/vs/...">vs X</a>  (x11)
  </div>
</nav>
We insert the hub link just before the `</div>` that closes that nav's inner
div (the first `</div>` followed by `</nav>` after the "Compare:" span).
"""
import re
import sys
from pathlib import Path

VS_DIR = Path(__file__).resolve().parent.parent / "vs"

# The reciprocal link. A leading divider span sets it apart from the per-
# competitor links; the arrow signals "up to the index".
HUB_LINK = (
    '    <span class="text-white/10 shrink-0" aria-hidden="true">|</span>\n'
    '    <a href="/vs/" class="text-sky-400 hover:text-sky-300 font-medium shrink-0">'
    "All comparisons</a>\n"
)

# Marker substring used for the idempotency / --check test.
HUB_MARKER = '<a href="/vs/" '

COMPARE_SPAN = 'class="text-slate-500 font-medium shrink-0">Compare:</span>'
# Closing of the sub-nav inner div, immediately followed by </nav>.
CLOSE_RE = re.compile(r"([ \t]*)</div>\s*\n([ \t]*)</nav>")


def already_has_link(html: str) -> bool:
    return HUB_MARKER in html


def add_link(html: str, name: str) -> str:
    if already_has_link(html):
        return html
    if COMPARE_SPAN not in html:
        raise SystemExit(f"{name}: no 'Compare:' sub-nav found - structure changed")
    idx = html.index(COMPARE_SPAN)
    m = CLOSE_RE.search(html, idx)
    if not m:
        raise SystemExit(f"{name}: could not locate sub-nav close (</div></nav>)")
    insert_at = m.start()
    return html[:insert_at] + HUB_LINK + html[insert_at:]


def main() -> int:
    check = "--check" in sys.argv
    pages = sorted(p for p in VS_DIR.glob("*.html") if p.name != "index.html")
    if not pages:
        print("no /vs/*.html competitor pages found", file=sys.stderr)
        return 1

    missing, changed = [], []
    for page in pages:
        html = page.read_text(encoding="utf-8")
        if already_has_link(html):
            continue
        if check:
            missing.append(page.name)
            continue
        page.write_text(add_link(html, page.name), encoding="utf-8")
        changed.append(page.name)

    if check:
        if missing:
            print("MISSING hub link on: " + ", ".join(missing), file=sys.stderr)
            return 1
        print(f"OK: all {len(pages)} /vs/ pages link back to the hub")
        return 0

    if changed:
        print(f"Added hub link to {len(changed)} page(s): " + ", ".join(changed))
    else:
        print(f"No changes - all {len(pages)} /vs/ pages already link to the hub")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
