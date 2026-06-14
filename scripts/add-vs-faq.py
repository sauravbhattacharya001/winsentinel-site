#!/usr/bin/env python3
"""
add-vs-faq.py - add an FAQ section (visible + FAQPage JSON-LD) to every /vs/* page.

The comparison pages are the highest-intent SEO surface ("WinSentinel vs X"
queries), but they shipped without any FAQ. This injects, into each
vs/<slug>.html:

  1. A visible <section> with a <details>/<summary> accordion of Q&As, styled to
     match the existing dark Tailwind look.
  2. A matching schema.org FAQPage JSON-LD block in <head>.

Google requires FAQ structured data to mirror content that is *visible* on the
page, so the visible accordion and the JSON-LD are generated from the SAME
source of truth (FAQS below) - they can never drift.

Design notes
------------
- Idempotent: a page already carrying the FAQ markers is skipped, so this can be
  re-run safely (e.g. after adding a new competitor page).
- Each /vs/ page gets a small set of shared Q&As (free/Pro, Windows-only,
  open source, agent model) plus competitor-specific Q&As that reflect the exact
  positioning already on that page (e.g. EDR vendors are framed as
  complementary, not replaced).
- Answers are plain prose; the JSON-LD text is the same wording as the visible
  answer with tags stripped, so the two always agree.

Usage:
    python scripts/add-vs-faq.py            # inject into all vs/*.html
    python scripts/add-vs-faq.py --check    # exit 1 if any vs/ page lacks the FAQ
"""
from __future__ import annotations

import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VS_DIR = ROOT / "vs"

# Markers so we can detect / avoid double-injection.
SECTION_MARKER = "<!-- vs-faq:start -->"
SECTION_END = "<!-- vs-faq:end -->"
LD_MARKER = '"@type": "FAQPage"'

SITE = "https://winsentinel.ai"

# Shared Q&As that apply to every comparison (kept generic & true everywhere).
SHARED_FAQS: list[tuple[str, str]] = [
    (
        "Is WinSentinel really free?",
        "Yes. The CLI and every audit module are free and open source under the MIT "
        "license, installed with <code>dotnet tool install --global WinSentinel.Cli</code>. "
        "A single machine gets the full power - all audit modules, the real-time monitor, "
        "scheduled scans, and PDF reports - with no limits and no account required. "
        "Pro is only for organizations that want to manage many machines from one "
        "control plane.",
    ),
    (
        "Does it only work on Windows?",
        "Yes. WinSentinel is built specifically for Windows 10 and Windows 11 (and "
        "Windows Server). It uses native Windows APIs to audit configuration that "
        "cross-platform tools treat generically, which is why its hardening checks are "
        "deeper on Windows.",
    ),
]


def offer_line(price_note: str) -> tuple[str, str]:
    """A consistent pricing Q used on every page, parameterised per competitor."""
    return (
        "How much does WinSentinel cost compared to {comp}?",
        "WinSentinel is free for unlimited use on a single machine. " + price_note +
        " WinSentinel Pro - which adds fleet management across many machines - is "
        "$29/mo for up to 25 nodes or $79/mo for up to 100 nodes, with annual billing "
        "saving 17%.",
    )


# Per-competitor: display name + the competitor-specific Q&As.
# Keep these factual and aligned with the positioning already on each page.
COMPETITORS: dict[str, dict] = {
    "microsoft-defender": {
        "comp": "Microsoft Defender",
        "price_note": "Defender ships with Windows at no extra cost, but it is antivirus, "
        "not configuration hardening.",
        "faqs": [
            (
                "Does WinSentinel replace Microsoft Defender?",
                "No - they do different jobs and work well together. Defender is "
                "antivirus and EDR that detects and blocks malware. WinSentinel audits "
                "and hardens your Windows configuration - the 30+ posture checks "
                "(firewall, BitLocker, SMB, credential exposure, PowerShell policy and "
                "more) that antivirus doesn't look at. Run both.",
            ),
            (
                "What does WinSentinel check that Defender doesn't?",
                "Defender focuses on threats and malware. WinSentinel covers "
                "configuration posture: BitLocker and TPM status, firewall rules, open "
                "ports, SMBv1, LLMNR/NBT-NS, local-admin sprawl, PowerShell logging and "
                "execution policy, encryption coverage, and dozens of other settings, "
                "each with a one-click fix.",
            ),
        ],
    },
    "nessus": {
        "comp": "Nessus",
        "price_note": "Nessus Professional is $3,990/year and Nessus Expert is $5,990/year.",
        "faqs": [
            (
                "Is WinSentinel a cheaper alternative to Nessus?",
                "For Windows hardening, yes. Nessus is a vulnerability scanner that "
                "reports findings for a per-product annual fee. WinSentinel is a free, "
                "always-on Windows agent that not only finds misconfigurations but fixes "
                "them with one click, and gives you a 0-100 posture score.",
            ),
            (
                "What's the difference between Nessus and WinSentinel?",
                "Nessus does point-in-time vulnerability scans and produces reports. "
                "WinSentinel monitors continuously, auto-remediates, and is purpose-built "
                "for Windows configuration hardening rather than generic CVE scanning.",
            ),
        ],
    },
    "qualys": {
        "comp": "Qualys",
        "price_note": "Qualys VMDR is an enterprise cloud platform that typically starts "
        "around $15,000+/year.",
        "faqs": [
            (
                "Is WinSentinel an alternative to Qualys VMDR?",
                "For Windows posture hardening on individual machines, WinSentinel is a "
                "free, lightweight alternative. Qualys VMDR is a large enterprise cloud "
                "scanner; WinSentinel installs in 30 seconds, runs locally, and "
                "auto-fixes findings instead of only reporting them.",
            ),
            (
                "Does WinSentinel need a cloud account like Qualys?",
                "No. The free tier runs entirely on the local machine with no account and "
                "no data leaving the device. Only WinSentinel Pro (fleet management) phones "
                "home to a control plane, and that is opt-in.",
            ),
        ],
    },
    "rapid7": {
        "comp": "Rapid7",
        "price_note": "Rapid7 InsightVM is an enterprise platform that typically starts "
        "around $20,000+/year.",
        "faqs": [
            (
                "Is WinSentinel an alternative to Rapid7 InsightVM?",
                "For Windows hardening, WinSentinel is a free, single-machine alternative. "
                "InsightVM is an enterprise vulnerability-management platform; WinSentinel "
                "focuses on auditing and auto-remediating Windows configuration locally, "
                "with a posture score and no per-seat licensing.",
            ),
            (
                "Does WinSentinel do remediation like Rapid7?",
                "Yes - and it's built in and free. Every finding emits a one-click fix "
                "with a dry-run preview before it applies, so you can harden a machine "
                "immediately rather than exporting a report to another team.",
            ),
        ],
    },
    "lansweeper": {
        "comp": "Lansweeper",
        "price_note": "Lansweeper is asset-discovery software priced per asset (around "
        "$219+/year for small estates).",
        "faqs": [
            (
                "Is WinSentinel like Lansweeper?",
                "They solve different problems. Lansweeper inventories what hardware and "
                "software is on your network. WinSentinel tells you what's misconfigured "
                "or insecure on a machine and fixes it. Many teams use discovery and "
                "hardening tools side by side.",
            ),
            (
                "Does WinSentinel do asset inventory?",
                "It inventories security-relevant state - installed software, services, "
                "drivers, scheduled tasks, local accounts and more - as part of its audit, "
                "but its focus is hardening and remediation, not full IT asset management.",
            ),
        ],
    },
    "ninjaone": {
        "comp": "NinjaOne",
        "price_note": "NinjaOne is RMM/patching software priced per endpoint.",
        "faqs": [
            (
                "Is WinSentinel an RMM tool like NinjaOne?",
                "No. NinjaOne is remote monitoring and management focused on patching and "
                "device administration. WinSentinel is security hardening: it audits 13+ "
                "security modules, scores posture, and auto-remediates misconfigurations. "
                "Patching keeps software current; hardening fixes how it's configured.",
            ),
            (
                "Can I use WinSentinel alongside NinjaOne?",
                "Yes. Many teams run an RMM for patching and deploy WinSentinel for "
                "configuration hardening and posture scoring on the same fleet.",
            ),
        ],
    },
    "tanium": {
        "comp": "Tanium",
        "price_note": "Tanium is an enterprise platform with custom pricing and "
        "significant deployment overhead.",
        "faqs": [
            (
                "Is WinSentinel a lighter alternative to Tanium?",
                "Yes. Tanium is a powerful enterprise endpoint platform that requires "
                "dedicated infrastructure, long sales cycles and a team to run. WinSentinel "
                "installs in 30 seconds as a dotnet tool and delivers Windows hardening "
                "with no overhead - free on a single machine, with optional Pro fleet "
                "management.",
            ),
            (
                "Do I need infrastructure to run WinSentinel?",
                "No. The free agent runs locally with zero server-side setup. Pro fleet "
                "management uses a lightweight cloud control plane that you point agents at "
                "with a license key.",
            ),
        ],
    },
    "wazuh": {
        "comp": "Wazuh",
        "price_note": "Wazuh is free and open source, but it's a self-hosted SIEM/XDR you "
        "operate yourself.",
        "faqs": [
            (
                "Is WinSentinel an alternative to Wazuh?",
                "They overlap but differ in focus and effort. Wazuh is a self-hosted "
                "SIEM/XDR built Linux-first that you must deploy and maintain. WinSentinel "
                "is purpose-built for Windows hardening with auto-remediation and installs "
                "in seconds. Different missions - log/event analytics versus configuration "
                "hardening.",
            ),
            (
                "Does WinSentinel need a server like Wazuh?",
                "No. The free tier runs entirely on the local Windows machine. There's no "
                "manager, indexer, or dashboard server to stand up - that complexity is "
                "exactly what WinSentinel avoids for single-machine hardening.",
            ),
        ],
    },
    "crowdstrike": {
        "comp": "CrowdStrike",
        "price_note": "CrowdStrike Falcon is per-endpoint EDR with annual contracts.",
        "faqs": [
            (
                "Does WinSentinel replace CrowdStrike Falcon?",
                "No - they're complementary. CrowdStrike detects and responds to threats "
                "after they reach an endpoint. WinSentinel reduces the attack surface "
                "beforehand by hardening Windows configuration. Running both gives you "
                "defense in depth: prevention plus detection.",
            ),
            (
                "Should I run WinSentinel and CrowdStrike together?",
                "Yes. WinSentinel hardens the machine (firewall, encryption, SMB, "
                "credentials, PowerShell policy and more) so there's less for an EDR to "
                "catch, while CrowdStrike handles active threat detection and response.",
            ),
        ],
    },
    "sentinelone": {
        "comp": "SentinelOne",
        "price_note": "SentinelOne Singularity is per-endpoint EDR/XDR with annual contracts.",
        "faqs": [
            (
                "Does WinSentinel replace SentinelOne?",
                "No - they complement each other. SentinelOne uses AI to detect and "
                "respond to active threats. WinSentinel eliminates attack surfaces before "
                "threats arrive by hardening Windows configuration. Together they form a "
                "complete defense-in-depth strategy.",
            ),
            (
                "Is WinSentinel an EDR?",
                "No. WinSentinel is a configuration-hardening and posture tool, not an "
                "endpoint detection and response product. It pairs with an EDR like "
                "SentinelOne rather than replacing it.",
            ),
        ],
    },
    "intune": {
        "comp": "Microsoft Intune",
        "price_note": "Intune is licensed per user (often bundled with Microsoft 365 E3/E5).",
        "faqs": [
            (
                "Does WinSentinel replace Microsoft Intune?",
                "No - they're complementary. Intune manages devices through MDM policies "
                "and compliance checks. WinSentinel goes deeper on each machine, actively "
                "hardening security posture and auto-fixing misconfigurations that Intune's "
                "compliance policies never inspect.",
            ),
            (
                "Can WinSentinel report into an Intune-managed fleet?",
                "WinSentinel runs independently of Intune. The free agent hardens each "
                "device locally; WinSentinel Pro adds its own fleet control plane for "
                "cross-machine posture, which you can run alongside Intune device "
                "management.",
            ),
        ],
    },
}


def build_faqs(slug: str) -> list[tuple[str, str]]:
    info = COMPETITORS[slug]
    comp = info["comp"]
    q_price, a_price = offer_line(info["price_note"])
    faqs: list[tuple[str, str]] = []
    faqs.extend(info["faqs"])
    faqs.append((q_price.format(comp=comp), a_price))
    faqs.extend(SHARED_FAQS)
    return faqs


def strip_tags(s: str) -> str:
    """Plain text for JSON-LD answers (visible answer minus inline tags)."""
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", s)).strip()


def render_visible(slug: str, faqs: list[tuple[str, str]]) -> str:
    comp = COMPETITORS[slug]["comp"]
    items = []
    for q, a in faqs:
        items.append(
            f'''        <details class="group border border-white/10 rounded-lg bg-ink-950/50 px-5 py-4">
          <summary class="flex cursor-pointer items-center justify-between text-white font-medium list-none">
            <span>{html.escape(q)}</span>
            <span class="ml-4 text-slate-500 transition-transform group-open:rotate-45">+</span>
          </summary>
          <p class="mt-3 text-sm text-slate-400 leading-relaxed">{a}</p>
        </details>'''
        )
    body = "\n".join(items)
    return f'''{SECTION_MARKER}
<section class="border-t border-white/5 bg-ink-900/30">
  <div class="max-w-3xl mx-auto px-6 py-16">
    <h2 class="text-2xl font-bold text-white text-center mb-8">WinSentinel vs {html.escape(comp)}: FAQ</h2>
    <div class="space-y-3">
{body}
    </div>
  </div>
</section>
{SECTION_END}
'''


def render_ldjson(faqs: list[tuple[str, str]]) -> str:
    data = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
            {
                "@type": "Question",
                "name": strip_tags(q),
                "acceptedAnswer": {"@type": "Answer", "text": strip_tags(a)},
            }
            for q, a in faqs
        ],
    }
    inner = json.dumps(data, indent=2, ensure_ascii=False)
    return f'  <script type="application/ld+json">\n{inner}\n  </script>\n'


def inject(path: Path) -> str:
    slug = path.stem
    if slug not in COMPETITORS:
        return "skip (no FAQ data)"
    html_text = path.read_text(encoding="utf-8")
    if SECTION_MARKER in html_text or LD_MARKER in html_text:
        return "already has FAQ"

    faqs = build_faqs(slug)

    # 1) JSON-LD before </head>
    ld = render_ldjson(faqs)
    if "</head>" not in html_text:
        return "ERROR: no </head>"
    html_text = html_text.replace("</head>", ld + "</head>", 1)

    # 2) visible section before the footer mount (fallback: before </body>)
    visible = render_visible(slug, faqs)
    if '<div id="site-footer">' in html_text:
        html_text = html_text.replace(
            '<div id="site-footer">', visible + '\n<div id="site-footer">', 1
        )
    elif "</body>" in html_text:
        html_text = html_text.replace("</body>", visible + "\n</body>", 1)
    else:
        return "ERROR: no footer mount or </body>"

    path.write_text(html_text, encoding="utf-8")
    return f"injected {len(faqs)} Q&As"


def main(argv: list[str]) -> int:
    check_only = "--check" in argv
    pages = sorted(VS_DIR.glob("*.html"))
    missing = 0
    for p in pages:
        if p.stem not in COMPETITORS:
            print(f"  --  {p.name}: no FAQ data (skipped)")
            continue
        text = p.read_text(encoding="utf-8")
        has = SECTION_MARKER in text and LD_MARKER in text
        if check_only:
            status = "ok" if has else "MISSING FAQ"
            if not has:
                missing += 1
            print(f"  {'OK ' if has else 'FAIL'} {p.name}: {status}")
        else:
            print(f"  {p.name}: {inject(p)}")
    if check_only and missing:
        print(f"\n{missing} vs/ page(s) missing FAQ", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
