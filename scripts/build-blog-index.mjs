#!/usr/bin/env node
// Rebuild the blog index (blog.html) and each post's prev/next nav from the
// per-post pages under blog/*.html. Post pages are the source of truth: this
// script reads their BlogPosting JSON-LD + <time> label, sorts newest-first,
// regenerates the index cards + Blog JSON-LD, and rewrites the prev/next footer
// links in every post so reading order stays correct after you add/remove a post.
//
// Run this after adding a post (scripts/new-post.mjs does it for you):
//   node scripts/build-blog-index.mjs
//   node scripts/build-blog-index.mjs --check   # report only, write nothing
//
// No external deps. Idempotent: running twice produces no diff.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BLOG_DIR = resolve(ROOT, "blog");
const ORIGIN = "https://winsentinel.ai";
const CHECK = process.argv.includes("--check");

const stripTags = (s) => String(s ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---------------------------------------------------------------------------
// 1. Load every post page (skip _partials) and extract its metadata.
// ---------------------------------------------------------------------------
function loadPosts() {
  const files = readdirSync(BLOG_DIR).filter((f) => f.endsWith(".html") && !f.startsWith("_"));
  const posts = [];
  for (const file of files) {
    const slug = file.replace(/\.html$/, "");
    const html = readFileSync(join(BLOG_DIR, file), "utf8");
    const ldM = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    if (!ldM) {
      console.error(`! ${file}: no JSON-LD block — skipping. Add BlogPosting JSON-LD or use new-post.mjs.`);
      continue;
    }
    let ld;
    try { ld = JSON.parse(ldM[1]); } catch (e) {
      console.error(`! ${file}: invalid JSON-LD (${e.message}) — skipping.`);
      continue;
    }
    const timeM = html.match(/<time[^>]*>([\s\S]*?)<\/time>/);
    posts.push({
      slug,
      file,
      title: stripTags(ld.headline) || slug,
      iso: ld.datePublished || "",
      description: ld.description || "",
      dateText: timeM ? timeM[1].trim() : ld.datePublished || "",
    });
  }
  // Newest first; tie-break on slug for stable ordering.
  posts.sort((a, b) => (b.iso || "").localeCompare(a.iso || "") || a.slug.localeCompare(b.slug));
  return posts;
}

// ---------------------------------------------------------------------------
// 2. Rewrite the prev/next footer nav inside each post page to match order.
//    prev = newer post (left), next = older post (right). Idempotent.
// ---------------------------------------------------------------------------
const NAV_RE = /<nav class="mt-16 pt-8 border-t border-white\/10 flex items-center justify-between gap-6 text-sm text-slate-400">[\s\S]*?<\/nav>/;

function navHtml(prev, next) {
  const left = prev ? `<a href="/blog/${prev.slug}" class="hover:text-white">← ${escAttr(prev.title)}</a>` : `<span></span>`;
  const right = next ? `<a href="/blog/${next.slug}" class="hover:text-white text-right">${escAttr(next.title)} →</a>` : `<span></span>`;
  return `<nav class="mt-16 pt-8 border-t border-white/10 flex items-center justify-between gap-6 text-sm text-slate-400">
    ${left}
    ${right}
  </nav>`;
}

function fixPostNav(posts) {
  let changed = 0;
  posts.forEach((p, i) => {
    const prev = posts[i - 1]; // newer
    const next = posts[i + 1]; // older
    const path = join(BLOG_DIR, p.file);
    const html = readFileSync(path, "utf8");
    if (!NAV_RE.test(html)) {
      console.error(`! ${p.file}: no prev/next <nav> found — leaving as-is.`);
      return;
    }
    const updated = html.replace(NAV_RE, navHtml(prev, next));
    if (updated !== html) {
      if (!CHECK) writeFileSync(path, updated, "utf8");
      changed++;
    }
  });
  return changed;
}

// ---------------------------------------------------------------------------
// 3. Render and write blog.html (index).
// ---------------------------------------------------------------------------
const FAVICON = `<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cpath fill='%2338bdf8' d='M32 4 8 14v18c0 14 10 24 24 28 14-4 24-14 24-28V14L32 4Z'/%3E%3Cpath fill='%230b0f17' d='m28 38-7-7 3-3 4 4 11-11 3 3-14 14Z'/%3E%3C/svg%3E" />`;

// Cloudflare Web Analytics loader (cookieless; Site roadmap S9). The index is fully
// regenerated here, so it MUST emit this block or every rebuild silently strips the
// loader off blog.html and someone has to re-run scripts/add-analytics.py. Keep this
// byte-identical to what add-analytics.py injects (and to new-post.mjs) so the page
// stays idempotent under both. No indentation: existing pages put </head> at column 0.
const ANALYTICS_LOADER = `<!-- Cloudflare Web Analytics (cookieless). Token is set out-of-band; loader no-ops until configured. -->
<script>window.__WS_CF_BEACON_TOKEN__ = "__CF_BEACON_TOKEN__";</script>
<script defer src="/js/cf-analytics.js"></script>`;

function headBoilerplate() {
  // Reuse the Tailwind config + <style> from an existing post page so the index
  // never drifts from the post styling.
  const sample = readdirSync(BLOG_DIR).filter((f) => f.endsWith(".html") && !f.startsWith("_"))[0];
  const html = readFileSync(join(BLOG_DIR, sample), "utf8");
  const twStart = html.indexOf("<script>", html.indexOf("tailwind.config") - 200);
  const twEnd = html.indexOf("</script>", twStart) + "</script>".length;
  const stStart = html.indexOf("<style>");
  const stEnd = html.indexOf("</style>", stStart) + "</style>".length;
  return `  <script src="https://cdn.tailwindcss.com"></script>
  ${html.slice(twStart, twEnd)}
  ${html.slice(stStart, stEnd)}`;
}

function renderIndex(posts) {
  const cards = posts.map((p) => `    <a href="/blog/${p.slug}" class="block border-b border-white/5 pb-8 group">
      <time class="text-xs text-slate-500 uppercase tracking-wider">${escAttr(p.dateText)}</time>
      <h2 class="mt-2 text-2xl font-bold text-white group-hover:text-sky-300 transition-colors">${escAttr(p.title)}</h2>
      <p class="mt-3 text-slate-300">${escAttr(p.description)}</p>
      <span class="mt-3 inline-block text-sm text-sky-400 group-hover:text-sky-300">Read more →</span>
    </a>`).join("\n\n");

  const ld = {
    "@context": "https://schema.org",
    "@type": "Blog",
    "@id": `${ORIGIN}/blog`,
    "url": `${ORIGIN}/blog`,
    "name": "WinSentinel Blog",
    "description": "Security tips, audit walkthroughs, and product updates for Windows security professionals.",
    "publisher": {
      "@type": "Organization",
      "name": "WinSentinel",
      "url": ORIGIN,
      "logo": { "@type": "ImageObject", "url": `${ORIGIN}/og/default.svg` },
    },
    "blogPost": posts.map((p) => ({
      "@type": "BlogPosting",
      "@id": `${ORIGIN}/blog/${p.slug}`,
      "headline": p.title,
      "datePublished": p.iso,
      "url": `${ORIGIN}/blog/${p.slug}`,
      "description": p.description,
      "author": { "@type": "Person", "name": "Saurav Bhattacharya" },
    })),
  };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Blog — WinSentinel</title>
  <meta name="description" content="WinSentinel blog: security tips, audit walkthroughs, and product updates for Windows security professionals." />
  <meta name="theme-color" content="#0b0f17" />
  <meta property="og:title" content="WinSentinel Blog" />
  <meta property="og:description" content="Security tips, audit walkthroughs, and product updates for Windows." />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${ORIGIN}/blog" />
  <meta property="og:image" content="${ORIGIN}/og/blog.png" />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content="${ORIGIN}/og/blog.png" />
  <meta name="twitter:title" content="WinSentinel Blog" />
  <meta name="twitter:description" content="Security tips, audit walkthroughs, and product updates for Windows." />
  <link rel="canonical" href="${ORIGIN}/blog" />
  <link rel="alternate" type="application/atom+xml" title="WinSentinel Blog" href="${ORIGIN}/blog/feed.xml" />
  ${FAVICON}
${headBoilerplate()}
  <script type="application/ld+json">
${JSON.stringify(ld, null, 2)}
  </script>
  <script>
    // Keep legacy deep links alive: /blog#slug -> /blog/slug
    (function () {
      var h = location.hash.replace(/^#/, "");
      if (h && /^[a-z0-9-]+$/.test(h)) location.replace("/blog/" + h);
    })();
  </script>
${ANALYTICS_LOADER}
</head>
<body class="font-sans text-slate-200 antialiased">

<div id="site-header"></div>

<section class="max-w-3xl mx-auto px-6 pt-16 pb-20">
  <h1 class="text-3xl md:text-4xl font-bold text-white">Blog</h1>
  <p class="mt-3 text-slate-400 text-lg">Security insights, audit walkthroughs, and product updates.</p>
  <p class="mt-2 text-sm text-slate-500"><a href="/blog/feed.xml" class="text-sky-400 hover:text-sky-300">Subscribe via RSS/Atom →</a></p>

  <div class="mt-12 space-y-8">
${cards}
  </div>
</section>

<div id="site-footer"></div>
<script src="/components/nav.js"></script>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// 4. Run.
// ---------------------------------------------------------------------------
const toCrlf = (s) => s.replace(/\r?\n/g, "\r\n"); // match repo's CRLF HTML convention
const posts = loadPosts();
if (!posts.length) {
  console.error("No post pages found in blog/. Nothing to do.");
  process.exit(1);
}

const navChanged = fixPostNav(posts);
const indexHtml = toCrlf(renderIndex(posts));
const indexPath = resolve(ROOT, "blog.html");
const indexChanged = readFileSync(indexPath, "utf8") !== indexHtml;

if (CHECK) {
  console.log(`${posts.length} posts (newest: ${posts[0].slug} @ ${posts[0].iso}).`);
  console.log(`Would ${indexChanged ? "rewrite" : "leave"} blog.html; ${navChanged} post nav block(s) would change.`);
  process.exit(0);
}

if (indexChanged) writeFileSync(indexPath, indexHtml, "utf8");
console.log(`Index ${indexChanged ? "rebuilt" : "unchanged"} (${posts.length} posts). Updated nav in ${navChanged} post page(s).`);
posts.forEach((p, i) => console.log(`  ${String(i + 1).padStart(2)}. /blog/${p.slug}  (${p.iso})`));
