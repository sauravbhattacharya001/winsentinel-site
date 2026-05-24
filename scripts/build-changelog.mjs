#!/usr/bin/env node
// Build /changelog.html from the WinSentinel GitHub Releases feed.
// Run during the Pages workflow (or locally) — see .github/workflows/pages.yml.
// Usage: node scripts/build-changelog.mjs [out.html]
//
// Env:
//   GITHUB_TOKEN  - optional, raises the unauthenticated 60/hr rate limit
//   REPO          - default sauravbhattacharya001/WinSentinel

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const REPO = process.env.REPO || "sauravbhattacharya001/WinSentinel";
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const OUT = resolve(process.argv[2] || "changelog.html");

const headers = {
  "Accept": "application/vnd.github+json",
  "User-Agent": "winsentinel-site-changelog-builder",
};
if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;

async function fetchAllReleases() {
  const all = [];
  for (let page = 1; page <= 5; page++) {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100&page=${page}`, { headers });
    if (!res.ok) {
      throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    }
    const batch = await res.json();
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all.filter(r => !r.draft);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Minimal, dependency-free markdown → HTML for release notes.
// Covers: headings, bullets, inline code, bold/italic, links, line breaks.
function md(src) {
  if (!src) return "";
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let inList = false;
  let inCode = false;
  let codeBuf = [];
  const flushList = () => { if (inList) { out.push("</ul>"); inList = false; } };

  const inline = (t) => escapeHtml(t)
    .replace(/`([^`]+)`/g, '<code class="bg-ink-800 px-1.5 py-0.5 rounded text-sky-200 text-[0.9em]">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" class="text-sky-400 hover:text-sky-300 underline-offset-2 hover:underline" rel="noopener">$1</a>')
    .replace(/(?<![">])(https?:\/\/[^\s<)]+)/g, '<a href="$1" class="text-sky-400 hover:text-sky-300" rel="noopener">$1</a>')
    .replace(/#(\d+)\b/g, `<a href="https://github.com/${REPO}/issues/$1" class="text-sky-400 hover:text-sky-300" rel="noopener">#$1</a>`);

  for (const raw of lines) {
    if (raw.startsWith("```")) {
      if (inCode) {
        out.push(`<pre class="bg-ink-950/80 border border-white/10 rounded-md p-3 overflow-x-auto text-xs my-3"><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
        codeBuf = [];
        inCode = false;
      } else {
        flushList();
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeBuf.push(raw); continue; }

    const line = raw.trimEnd();
    if (!line.trim()) { flushList(); continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushList();
      const lvl = Math.min(h[1].length + 2, 6); // demote so page H1 wins
      out.push(`<h${lvl} class="font-semibold text-white mt-4 mb-2">${inline(h[2])}</h${lvl}>`);
      continue;
    }
    const li = line.match(/^[\s]*[-*]\s+(.*)$/);
    if (li) {
      if (!inList) { out.push('<ul class="list-disc list-outside pl-5 space-y-1 text-slate-300 my-2">'); inList = true; }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    flushList();
    out.push(`<p class="text-slate-300 my-2 leading-relaxed">${inline(line)}</p>`);
  }
  flushList();
  if (inCode && codeBuf.length) {
    out.push(`<pre class="bg-ink-950/80 border border-white/10 rounded-md p-3 overflow-x-auto text-xs my-3"><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
  }
  return out.join("\n");
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function renderRelease(r) {
  const title = r.name || r.tag_name;
  const isLatest = r.tag_name && !r.prerelease && r === latestRef;
  return `
  <article id="${escapeHtml(r.tag_name)}" class="rounded-2xl border border-white/10 bg-ink-900/60 p-6 md:p-8">
    <header class="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-4">
      <h2 class="text-2xl font-bold text-white">
        <a href="#${escapeHtml(r.tag_name)}" class="hover:text-sky-300">${escapeHtml(title)}</a>
      </h2>
      <span class="text-sm text-slate-400">${fmtDate(r.published_at || r.created_at)}</span>
      ${isLatest ? '<span class="pill">Latest</span>' : ""}
      ${r.prerelease ? '<span class="text-[11px] uppercase tracking-widest text-amber-300 border border-amber-400/30 rounded-full px-2 py-0.5">pre-release</span>' : ""}
      <a href="${escapeHtml(r.html_url)}" class="ml-auto text-xs text-slate-400 hover:text-sky-300" rel="noopener">View on GitHub →</a>
    </header>
    <div class="prose prose-invert max-w-none text-slate-300">
      ${md(r.body || "_No release notes._")}
    </div>
  </article>`;
}

let latestRef = null;

function buildHtml(releases) {
  releases.sort((a, b) => new Date(b.published_at || b.created_at) - new Date(a.published_at || a.created_at));
  latestRef = releases.find(r => !r.prerelease) || releases[0];
  const cards = releases.map(renderRelease).join("\n");
  const built = new Date().toISOString();
  const count = releases.length;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Changelog - WinSentinel</title>
  <meta name="description" content="WinSentinel release notes. Every version of the Windows security audit CLI, what changed, and when." />
  <meta name="theme-color" content="#0b0f17" />
  <meta property="og:title" content="WinSentinel Changelog" />
  <meta property="og:description" content="Every WinSentinel release, what changed, and when." />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://winsentinel.ai/changelog" />
  <meta property="og:image" content="https://winsentinel.ai/og-pricing.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="canonical" href="https://winsentinel.ai/changelog" />
  <link rel="alternate" type="application/atom+xml" title="WinSentinel releases" href="https://github.com/${REPO}/releases.atom" />
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cpath fill='%2338bdf8' d='M32 4 8 14v18c0 14 10 24 24 28 14-4 24-14 24-28V14L32 4Z'/%3E%3Cpath fill='%230b0f17' d='m28 38-7-7 3-3 4 4 11-11 3 3-14 14Z'/%3E%3C/svg%3E" />
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: { extend: {
        fontFamily: {
          mono: ['ui-monospace','SFMono-Regular','Menlo','Monaco','Consolas','monospace'],
          sans: ['Inter','ui-sans-serif','system-ui','-apple-system','Segoe UI','Roboto','sans-serif'],
        },
        colors: { ink: { 950:'#070a11', 900:'#0b0f17', 800:'#11161f', 700:'#1a2030' } },
      } }
    };
  </script>
  <style>
    html { scroll-behavior: smooth; }
    body { background: radial-gradient(1200px 600px at 50% -200px, #0e1a2d 0%, #070a11 60%, #070a11 100%); }
    .pill { display:inline-flex; align-items:center; gap:.35rem; font-size:11px; padding:2px 8px; border-radius:999px; background:rgba(56,189,248,.12); color:#7dd3fc; border:1px solid rgba(56,189,248,.25); }
    .toc a:hover { color: #fff; }
  </style>
</head>
<body class="font-sans text-slate-200 antialiased">

<header class="border-b border-white/5 bg-ink-950/60 backdrop-blur sticky top-0 z-40">
  <div class="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
    <a href="/" class="flex items-center gap-2 font-semibold">
      <svg viewBox="0 0 64 64" class="w-7 h-7"><path fill="#38bdf8" d="M32 4 8 14v18c0 14 10 24 24 28 14-4 24-14 24-28V14L32 4Z"/><path fill="#0b0f17" d="m28 38-7-7 3-3 4 4 11-11 3 3-14 14Z"/></svg>
      <span>WinSentinel</span>
      <span class="ml-2 text-xs rounded-full border border-sky-400/30 text-sky-300 px-2 py-0.5">beta</span>
    </a>
    <nav class="hidden md:flex items-center gap-7 text-sm text-slate-300">
      <a href="/#features" class="hover:text-white">Features</a>
      <a href="/pricing" class="hover:text-white">Pricing</a>
      <a href="/changelog" class="text-white">Changelog</a>
      <a href="/#install" class="hover:text-white">Install</a>
      <a href="https://github.com/${REPO}" class="hover:text-white">GitHub</a>
    </nav>
    <a href="/#waitlist" class="text-sm bg-sky-500 hover:bg-sky-400 text-ink-950 font-semibold px-3.5 py-2 rounded-md">Join waitlist</a>
  </div>
</header>

<section class="relative">
  <div class="max-w-5xl mx-auto px-6 pt-14 pb-8 text-center">
    <span class="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-sky-300/90 border border-sky-400/30 rounded-full px-3 py-1">
      <span class="w-1.5 h-1.5 rounded-full bg-sky-400"></span>
      ${count} releases
    </span>
    <h1 class="mt-6 text-4xl md:text-5xl font-bold tracking-tight text-white">
      Changelog
    </h1>
    <p class="mt-5 max-w-2xl mx-auto text-lg text-slate-300">
      Everything we ship, tagged and dated. Auto-generated from
      <a href="https://github.com/${REPO}/releases" class="text-sky-400 hover:text-sky-300" rel="noopener">GitHub Releases</a>
      at deploy time.
    </p>
    <div class="mt-4 text-xs text-slate-500">
      <a href="https://github.com/${REPO}/releases.atom" class="hover:text-sky-300" rel="noopener">Atom feed</a>
      <span class="mx-2">·</span>
      <span>built ${escapeHtml(built)}</span>
    </div>
  </div>
</section>

<main class="max-w-5xl mx-auto px-6 pb-24">
  <nav class="toc rounded-xl border border-white/10 bg-ink-900/60 p-5 mb-8">
    <div class="text-xs uppercase tracking-widest text-slate-400 mb-3">Jump to version</div>
    <div class="flex flex-wrap gap-2 text-sm">
      ${releases.map(r => `<a href="#${escapeHtml(r.tag_name)}" class="text-slate-300 px-2.5 py-1 rounded border border-white/10 hover:border-sky-400/40 hover:text-sky-300">${escapeHtml(r.tag_name)}</a>`).join("\n      ")}
    </div>
  </nav>

  <div class="space-y-8">
    ${cards}
  </div>
</main>

<footer class="border-t border-white/5 mt-8">
  <div class="max-w-6xl mx-auto px-6 py-8 text-sm text-slate-400 flex flex-wrap items-center justify-between gap-3">
    <div>© ${new Date().getFullYear()} WinSentinel · MIT licensed</div>
    <div class="flex items-center gap-5">
      <a href="/pricing" class="hover:text-white">Pricing</a>
      <a href="https://github.com/${REPO}" class="hover:text-white" rel="noopener">GitHub</a>
      <a href="https://github.com/${REPO}/releases.atom" class="hover:text-white" rel="noopener">RSS</a>
    </div>
  </div>
</footer>
</body>
</html>
`;
}

const releases = await fetchAllReleases();
if (!releases.length) {
  console.error("No releases returned — refusing to overwrite changelog.html");
  process.exit(1);
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, buildHtml(releases), "utf8");
console.log(`Wrote ${OUT} with ${releases.length} releases.`);
