#!/usr/bin/env node
// Rebuild modules.html (the "/modules" page) from data/modules.json.
//
// data/modules.json is the source of truth and mirrors the audit modules
// shipped in the public CLI (WinSentinel.Core/Audits/*Audit.cs). Regenerate the
// page whenever the module list changes:
//   node scripts/build-modules.mjs
//   node scripts/build-modules.mjs --check   # report only, write nothing (CI)
//
// No external deps. Idempotent: running twice produces no diff.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://winsentinel.ai";
const CHECK = process.argv.includes("--check");

const escAttr = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
// Text nodes: same as attributes but also turn straight apostrophes into a
// typographic one so the page matches the rest of the site's copy style.
const escText = (s) => escAttr(s).replace(/'/g, "&#8217;");

const FAVICON = `<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cpath fill='%2338bdf8' d='M32 4 8 14v18c0 14 10 24 24 28 14-4 24-14 24-28V14L32 4Z'/%3E%3Cpath fill='%230b0f17' d='m28 38-7-7 3-3 4 4 11-11 3 3-14 14Z'/%3E%3C/svg%3E" />`;

// Reuse the Tailwind config from an existing post page so styling never drifts.
function tailwindConfig() {
  const blogDir = join(ROOT, "blog");
  const sample = readdirSync(blogDir).filter((f) => f.endsWith(".html") && !f.startsWith("_"))[0];
  const html = readFileSync(join(blogDir, sample), "utf8");
  const twStart = html.indexOf("<script>", html.indexOf("tailwind.config") - 200);
  const twEnd = html.indexOf("</script>", twStart) + "</script>".length;
  return html.slice(twStart, twEnd);
}

function load() {
  const data = JSON.parse(readFileSync(join(ROOT, "data", "modules.json"), "utf8"));
  const flat = data.groups.flatMap((g) => g.modules);
  if (flat.length !== data.totalModules) {
    console.error(
      `! modules.json: totalModules=${data.totalModules} but ${flat.length} modules are listed. Fix the count or the list.`
    );
    process.exit(1);
  }
  return data;
}

function renderGroupCard(g) {
  const items = g.modules
    .map(
      (m) => `        <div class="mod">
          <div class="flex items-center justify-between gap-3">
            <h3 class="font-semibold text-white">${escText(m.name)}</h3>
            <span class="cat">${escText(m.category)}</span>
          </div>
          <p class="mt-1.5 text-sm text-slate-400">${escText(m.description)}</p>
        </div>`
    )
    .join("\n");
  return `      <section class="card p-6">
        <div class="flex items-baseline justify-between gap-3">
          <h2 class="text-xl font-semibold text-white">${escText(g.title)}</h2>
          <span class="text-xs text-slate-500">${g.modules.length} module${g.modules.length === 1 ? "" : "s"}</span>
        </div>
        <p class="mt-1.5 text-sm text-slate-300">${escText(g.blurb)}</p>
        <div class="mt-5 grid sm:grid-cols-2 gap-3">
${items}
        </div>
      </section>`;
}

function ldItemList(data) {
  let pos = 0;
  const elements = data.groups.flatMap((g) =>
    g.modules.map((m) => ({
      "@type": "ListItem",
      position: ++pos,
      name: m.name,
      description: m.description,
    }))
  );
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "WinSentinel audit modules",
    description: `The ${data.totalModules} security audit modules WinSentinel runs on Windows, every one free on a single machine.`,
    numberOfItems: elements.length,
    itemListOrder: "https://schema.org/ItemListUnordered",
    itemListElement: elements,
  };
}

function ldSoftware(data) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "WinSentinel",
    applicationCategory: "SecurityApplication",
    operatingSystem: "Windows 10, Windows 11",
    url: `${ORIGIN}/modules`,
    downloadUrl: "https://www.nuget.org/packages/WinSentinel.Cli",
    description: `WinSentinel audits Windows across ${data.totalModules} security modules covering identity, system hardening, network exposure, applications, data protection, and forensics. Free on a single machine.`,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      url: `${ORIGIN}/pricing`,
    },
    author: { "@type": "Person", name: "Saurav Bhattacharya" },
  };
}

function ldBreadcrumb() {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${ORIGIN}/` },
      { "@type": "ListItem", position: 2, name: "Audit modules", item: `${ORIGIN}/modules` },
    ],
  };
}

function render(data) {
  const tocLinks = data.groups
    .map(
      (g) =>
        `      <a href="#${g.id}" class="toc-chip">${escText(g.title)} <span class="text-slate-500">${g.modules.length}</span></a>`
    )
    .join("\n");
  // Add an id anchor to each rendered section by post-processing: simplest is to
  // inject the id in renderGroupCard, but we keep that function clean and add the
  // ids here via a tagged wrapper instead.
  const groupCardsWithIds = data.groups
    .map((g) => renderGroupCard(g).replace('<section class="card p-6">', `<section id="${g.id}" class="card p-6 scroll-mt-24">`))
    .join("\n\n");

  const total = data.totalModules;
  const desc = `Every one of WinSentinel's ${total} Windows security audit modules, grouped by domain - identity, system hardening, network, applications, data protection, and forensics. All free on a single machine.`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>All ${total} audit modules &#8212; WinSentinel for Windows</title>
  <meta name="description" content="${escAttr(desc)}" />
  <meta name="theme-color" content="#0b0f17" />

  <meta property="og:title" content="All ${total} WinSentinel audit modules" />
  <meta property="og:description" content="${escAttr(`The complete list of ${total} Windows security checks WinSentinel runs - free on a single machine.`)}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${ORIGIN}/modules" />
  <meta property="og:image" content="${ORIGIN}/og/modules.png" />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content="${ORIGIN}/og/modules.png" />
  <meta name="twitter:title" content="All ${total} WinSentinel audit modules" />
  <meta name="twitter:description" content="${escAttr(`Every Windows security check WinSentinel runs, grouped by domain. Free on a single machine.`)}" />

  <script type="application/ld+json">
${JSON.stringify(ldItemList(data), null, 2)}
  </script>

  <script type="application/ld+json">
${JSON.stringify(ldSoftware(data), null, 2)}
  </script>

  <script type="application/ld+json">
${JSON.stringify(ldBreadcrumb(), null, 2)}
  </script>

  <link rel="canonical" href="${ORIGIN}/modules" />
  ${FAVICON}

  <script src="https://cdn.tailwindcss.com"></script>
  ${tailwindConfig()}
  <style>
    html { scroll-behavior: smooth; }
    body { background: radial-gradient(1200px 600px at 50% -200px, #0e1a2d 0%, #070a11 60%, #070a11 100%); }
    .card { border: 1px solid rgba(255,255,255,.08); background: rgba(11,15,23,.55); border-radius: 1rem; }
    .pill { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; }
    .mod { border: 1px solid rgba(255,255,255,.06); background: rgba(7,10,17,.5); border-radius: .6rem; padding: .85rem 1rem; }
    .cat { flex: none; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: #7dd3fc; border: 1px solid rgba(56,189,248,.3); border-radius: 9999px; padding: .1rem .5rem; }
    .toc-chip { display: inline-flex; align-items: center; gap: .4rem; font-size: .8rem; color: #cbd5e1; border: 1px solid rgba(255,255,255,.1); border-radius: 9999px; padding: .3rem .75rem; }
    .toc-chip:hover { border-color: rgba(56,189,248,.4); color: #fff; }
  </style>
  <!-- Cloudflare Web Analytics (cookieless). Token is set out-of-band; loader no-ops until configured. -->
  <script>window.__WS_CF_BEACON_TOKEN__ = "__CF_BEACON_TOKEN__";</script>
  <script defer src="/js/cf-analytics.js"></script>
</head>
<body class="font-sans text-slate-200 antialiased">

<div id="site-header"></div>

<!-- HERO -->
<section>
  <div class="max-w-5xl mx-auto px-6 pt-14 pb-6">
    <nav class="text-xs text-slate-500 mb-5">
      <a href="/" class="hover:text-slate-300">Home</a>
      <span class="mx-1.5">/</span>
      <span class="text-slate-300">Audit modules</span>
    </nav>
    <span class="pill text-sky-300">${total} modules &#183; all free on one machine</span>
    <h1 class="mt-3 text-3xl md:text-4xl font-bold text-white tracking-tight">Everything WinSentinel checks</h1>
    <p class="mt-4 text-lg text-slate-300 max-w-3xl">
      WinSentinel runs ${total} security audit modules against a Windows machine &#8212; real Windows APIs and
      registry reads, not screenshots from a blog post. Every finding maps to a concrete setting, service,
      or key you can inspect yourself. The full set runs on a single machine for free, with no license gate.
    </p>
    <div class="mt-6 flex flex-wrap gap-3 text-sm">
      <a href="/#install" class="bg-sky-500 hover:bg-sky-400 text-ink-950 font-semibold px-4 py-2 rounded-md">Install the CLI</a>
      <a href="/pricing" class="border border-white/15 hover:border-white/30 text-white px-4 py-2 rounded-md">See pricing</a>
    </div>
    <div class="mt-7 flex flex-wrap gap-2.5">
${tocLinks}
    </div>
  </div>
</section>

<!-- TERMINAL -->
<section>
  <div class="max-w-5xl mx-auto px-6 pb-4">
    <div class="rounded-xl border border-white/10 bg-ink-900/70 overflow-hidden">
      <div class="flex items-center gap-1.5 px-4 py-2.5 border-b border-white/5 bg-ink-800/60">
        <span class="w-3 h-3 rounded-full bg-red-400/70"></span>
        <span class="w-3 h-3 rounded-full bg-yellow-400/70"></span>
        <span class="w-3 h-3 rounded-full bg-green-400/70"></span>
        <span class="ml-3 text-xs text-slate-400 font-mono">pwsh &#8212; winsentinel</span>
      </div>
      <pre class="font-mono text-[13px] leading-6 p-5 overflow-x-auto"><span class="text-slate-500">PS&gt;</span> <span class="text-sky-300">winsentinel</span> --score

<span class="text-slate-400">Scanning ${total} modules&#8230;</span>
  &#10003; Firewall              <span class="text-emerald-400">OK</span>
  &#10003; Encryption            <span class="text-emerald-400">OK</span>
  &#10003; Network               <span class="text-rose-400">1 critical</span>
  &#10003; Identity &amp; Credential  <span class="text-amber-400">2 warnings</span>
  &#10003; Event Logs            <span class="text-emerald-400">OK</span>
  &#8230;
<span class="text-white">Security score: </span><span class="text-amber-400 font-semibold">78 / 100</span></pre>
    </div>
  </div>
</section>

<!-- MODULE GROUPS -->
<section>
  <div class="max-w-5xl mx-auto px-6 py-8 space-y-6">
${groupCardsWithIds}
  </div>
</section>

<!-- FREE vs PRO note -->
<section>
  <div class="max-w-5xl mx-auto px-6 py-6">
    <div class="card p-7">
      <h2 class="font-semibold text-white">All ${total} modules are free</h2>
      <p class="mt-2 text-sm text-slate-300 max-w-3xl">
        There is no &#8220;lite&#8221; tier. Every module on this page runs on your machine for free, forever &#8212;
        along with the real-time monitor, scheduled scans, one-click fixes, score history, and PDF/HTML/SARIF
        export. <span class="text-slate-100">WinSentinel Pro</span> does not add more checks; it takes these same
        agents and gives an organisation a control plane &#8212; run every module across a whole fleet from one
        place, with drift alerts, compliance rollups, and RBAC.
      </p>
      <div class="mt-5 flex flex-wrap gap-3 text-sm">
        <a href="/fleet" class="border border-white/15 hover:border-white/30 text-white px-4 py-2 rounded-md">How fleet management works</a>
        <a href="/pricing" class="text-sky-400 hover:text-sky-300 px-2 py-2">Compare Free vs Pro &#8594;</a>
      </div>
    </div>
  </div>
</section>

<!-- CTA -->
<section>
  <div class="max-w-3xl mx-auto px-6 py-12 text-center">
    <h2 class="text-2xl md:text-3xl font-bold text-white">Run all ${total} in one line</h2>
    <p class="mt-3 text-slate-300">WinSentinel ships as a .NET global tool. Audit your machine in under a minute.</p>
    <div class="mt-6 inline-flex items-center gap-2 rounded-md border border-white/10 bg-ink-900/80 px-4 py-2.5 font-mono text-sm text-slate-200">
      <span class="text-slate-500">$</span> dotnet tool install --global WinSentinel.Cli
    </div>
    <div class="mt-7 flex flex-wrap items-center justify-center gap-3">
      <a href="/#install" class="inline-flex items-center justify-center bg-sky-500 hover:bg-sky-400 text-ink-950 font-semibold px-6 py-3 rounded-md">Install the CLI</a>
      <a href="https://github.com/sauravbhattacharya001/WinSentinel" class="inline-flex items-center justify-center border border-white/15 hover:border-white/30 text-white px-6 py-3 rounded-md">View on GitHub</a>
    </div>
  </div>
</section>

<div id="site-footer"></div>
<script src="/components/nav.js"></script>
</body>
</html>
`;
}

const data = load();
const html = render(data).replace(/\r?\n/g, "\r\n"); // match repo's CRLF working-tree convention
const outPath = join(ROOT, "modules.html");
let current = "";
try { current = readFileSync(outPath, "utf8"); } catch {}
const changed = current !== html;

if (CHECK) {
  const flat = data.groups.flatMap((g) => g.modules);
  console.log(`${flat.length} modules across ${data.groups.length} groups.`);
  console.log(`Would ${changed ? "rewrite" : "leave"} modules.html.`);
  process.exit(0);
}

if (changed) writeFileSync(outPath, html, "utf8");
console.log(`modules.html ${changed ? "rebuilt" : "unchanged"} (${data.totalModules} modules, ${data.groups.length} groups).`);
