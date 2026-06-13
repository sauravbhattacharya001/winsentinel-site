#!/usr/bin/env node
// One-time migration + repeatable build: split the monolithic blog.html into
// one page per post under /blog/<slug>.html, and rewrite blog.html as a light
// index (title + date + excerpt + link). Keeps deep links working via a hash
// redirect on the index (/blog#slug -> /blog/slug).
//
// Why: the single-file blog grew to ~286 KB / 3.8k lines (every post inlined),
// so the whole archive loaded on first paint. Per-post pages give each article
// its own URL, <title>, canonical, OG card and JSON-LD BlogPosting (real SEO),
// and keep /blog tiny forever.
//
// Source of truth for post bodies remains blog.html until the split lands; the
// initial migration reads the legacy monolith. After migration, posts live as
// per-post pages under blog/<slug>.html — add new ones with scripts/new-post.mjs
// and rebuild the index with scripts/build-blog-index.mjs.
//
// Usage:
//   node scripts/split-blog.mjs            # read blog.html, write blog/*.html + new blog.html
//   node scripts/split-blog.mjs --check    # parse only, print what would be written
//
// No external deps.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(ROOT, "blog");
// One-time migration: reads the legacy monolithic blog.html (the source of
// truth for post bodies) and writes per-post pages + a light index. It refuses
// to run once blog.html no longer contains <article> blocks (i.e. already
// migrated), so a stray re-run can't wipe content. To re-run from scratch,
// restore the original first:  git show <pre-migration-rev>:blog.html > blog.html
const SRC = resolve(ROOT, process.env.BLOG_SRC || "blog.html");
const ORIGIN = "https://winsentinel.ai";
const CHECK = process.argv.includes("--check");

const html = readFileSync(SRC, "utf8");
if (!/<article id=/.test(html)) {
  console.error(`Source ${SRC} has no <article> blocks (already migrated?). Refusing to run; restore the original blog.html to re-migrate.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. Pull the shared <head> boilerplate (Tailwind config + <style>) so every
//    post page renders identically without duplicating it by hand here.
// ---------------------------------------------------------------------------
function slice(open, close, from = 0) {
  const a = html.indexOf(open, from);
  if (a === -1) return null;
  const b = html.indexOf(close, a + open.length);
  if (b === -1) return null;
  return { text: html.slice(a, b + close.length), start: a, end: b + close.length };
}

const twAnchor = html.indexOf("tailwind.config");
const tailwindCfg = twAnchor === -1 ? null : slice("<script>", "</script>", twAnchor - 200);
const styleBlock = slice("<style>", "</style>");
if (!tailwindCfg || !styleBlock) {
  console.error("Could not locate <head> Tailwind/style boilerplate in blog.html.");
  process.exit(1);
}
const HEAD_BOILERPLATE = `  <script src="https://cdn.tailwindcss.com"></script>
  ${tailwindCfg.text}
  ${styleBlock.text}`;

const FAVICON = `<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cpath fill='%2338bdf8' d='M32 4 8 14v18c0 14 10 24 24 28 14-4 24-14 24-28V14L32 4Z'/%3E%3Cpath fill='%230b0f17' d='m28 38-7-7 3-3 4 4 11-11 3 3-14 14Z'/%3E%3C/svg%3E" />`;

// ---------------------------------------------------------------------------
// 2. Parse the existing JSON-LD blogPost[] for clean per-post descriptions.
// ---------------------------------------------------------------------------
function parseDescriptions() {
  const map = new Map();
  const re = /"@id":\s*"https:\/\/winsentinel\.ai\/blog#([^"]+)"[\s\S]*?"datePublished":\s*"([^"]+)"[\s\S]*?"description":\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(html))) {
    const desc = JSON.parse(`"${m[3]}"`); // unescape JSON string
    map.set(m[1], { date: m[2], desc });
  }
  return map;
}
const meta = parseDescriptions();

// ---------------------------------------------------------------------------
// 3. Extract each <article id="..."> ... </article> with its parts.
// ---------------------------------------------------------------------------
function extractArticles() {
  const posts = [];
  const re = /<article id="([^"]+)"[^>]*>([\s\S]*?)<\/article>/g;
  let m;
  while ((m = re.exec(html))) {
    const slug = m[1];
    const inner = m[2];
    const timeM = inner.match(/<time[^>]*>([\s\S]*?)<\/time>/);
    const h2M = inner.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
    // Intro paragraph = first <p> before the .prose block.
    const proseIdx = inner.indexOf('<div class="prose');
    const head = proseIdx >= 0 ? inner.slice(0, proseIdx) : inner;
    const introM = head.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    const proseM = inner.match(/<div class="prose[^"]*"[^>]*>([\s\S]*)<\/div>\s*$/);
    posts.push({
      slug,
      dateText: timeM ? timeM[1].trim() : "",
      title: h2M ? h2M[1].replace(/\s+/g, " ").trim() : slug,
      intro: introM ? introM[1].trim() : "",
      prose: proseM ? proseM[1].trim() : (proseIdx >= 0 ? inner.slice(proseIdx) : ""),
    });
  }
  return posts;
}
const posts = extractArticles();
if (!posts.length) {
  console.error("No <article> blocks found — refusing to overwrite anything.");
  process.exit(1);
}

const stripTags = (s) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Excerpt: prefer the curated JSON-LD description, else derive from the intro.
function excerptFor(p) {
  const d = meta.get(p.slug)?.desc;
  if (d) return d;
  const t = stripTags(p.intro);
  return t.length > 200 ? t.slice(0, 197).replace(/\s+\S*$/, "") + "…" : t;
}
function isoDateFor(p) {
  const d = meta.get(p.slug)?.date;
  if (d) return d;
  const parsed = new Date(p.dateText);
  return isNaN(parsed) ? "" : parsed.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// 4. Render a single post page.
// ---------------------------------------------------------------------------
function renderPost(p, prev, next) {
  const url = `${ORIGIN}/blog/${p.slug}`;
  const excerpt = excerptFor(p);
  const iso = isoDateFor(p);
  const titlePlain = stripTags(p.title);
  const ld = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "@id": url,
    "headline": titlePlain,
    "datePublished": iso,
    "dateModified": iso,
    "url": url,
    "mainEntityOfPage": url,
    "description": excerpt,
    "author": { "@type": "Person", "name": "Saurav Bhattacharya" },
    "publisher": {
      "@type": "Organization",
      "name": "WinSentinel",
      "url": ORIGIN,
      "logo": { "@type": "ImageObject", "url": `${ORIGIN}/og/default.svg` },
    },
    "image": `${ORIGIN}/og/blog.png`,
    "isPartOf": { "@type": "Blog", "@id": `${ORIGIN}/blog`, "name": "WinSentinel Blog" },
  };
  const navLinks = [
    prev ? `<a href="/blog/${prev.slug}" class="hover:text-white">← ${escAttr(stripTags(prev.title))}</a>` : `<span></span>`,
    next ? `<a href="/blog/${next.slug}" class="hover:text-white text-right">${escAttr(stripTags(next.title))} →</a>` : `<span></span>`,
  ];
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escAttr(titlePlain)} — WinSentinel Blog</title>
  <meta name="description" content="${escAttr(excerpt)}" />
  <meta name="theme-color" content="#0b0f17" />
  <meta name="author" content="Saurav Bhattacharya" />
  <meta property="og:title" content="${escAttr(titlePlain)}" />
  <meta property="og:description" content="${escAttr(excerpt)}" />
  <meta property="og:type" content="article" />
  <meta property="article:published_time" content="${iso}" />
  <meta property="og:url" content="${url}" />
  <meta property="og:image" content="${ORIGIN}/og/blog.png" />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content="${ORIGIN}/og/blog.png" />
  <meta name="twitter:title" content="${escAttr(titlePlain)}" />
  <meta name="twitter:description" content="${escAttr(excerpt)}" />
  <link rel="canonical" href="${url}" />
  ${FAVICON}
${HEAD_BOILERPLATE}
  <script type="application/ld+json">
${JSON.stringify(ld, null, 2)}
  </script>
</head>
<body class="font-sans text-slate-200 antialiased">

<div id="site-header"></div>

<article class="max-w-3xl mx-auto px-6 pt-14 pb-20">
  <a href="/blog" class="text-sm text-sky-400 hover:text-sky-300">← All posts</a>
  <time class="mt-8 block text-xs text-slate-500 uppercase tracking-wider">${escAttr(p.dateText)}</time>
  <h1 class="mt-2 text-3xl md:text-4xl font-bold text-white leading-tight">${p.title}</h1>
  <p class="mt-4 text-lg text-slate-300">${p.intro}</p>

  <div class="prose mt-8">
    ${p.prose}
  </div>

  <nav class="mt-16 pt-8 border-t border-white/10 flex items-center justify-between gap-6 text-sm text-slate-400">
    ${navLinks.join("\n    ")}
  </nav>
</article>

<div id="site-footer"></div>
<script src="/components/nav.js"></script>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// 5. Render the new lightweight index (blog.html).
// ---------------------------------------------------------------------------
function renderIndex() {
  const cards = posts.map((p) => {
    const excerpt = excerptFor(p);
    return `    <a href="/blog/${p.slug}" class="block border-b border-white/5 pb-8 group">
      <time class="text-xs text-slate-500 uppercase tracking-wider">${escAttr(p.dateText)}</time>
      <h2 class="mt-2 text-2xl font-bold text-white group-hover:text-sky-300 transition-colors">${p.title}</h2>
      <p class="mt-3 text-slate-300">${escAttr(excerpt)}</p>
      <span class="mt-3 inline-block text-sm text-sky-400 group-hover:text-sky-300">Read more →</span>
    </a>`;
  }).join("\n\n");

  const blogPosts = posts.map((p) => ({
    "@type": "BlogPosting",
    "@id": `${ORIGIN}/blog/${p.slug}`,
    "headline": stripTags(p.title),
    "datePublished": isoDateFor(p),
    "url": `${ORIGIN}/blog/${p.slug}`,
    "description": excerptFor(p),
    "author": { "@type": "Person", "name": "Saurav Bhattacharya" },
  }));
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
    "blogPost": blogPosts,
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
  ${FAVICON}
${HEAD_BOILERPLATE}
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
</head>
<body class="font-sans text-slate-200 antialiased">

<div id="site-header"></div>

<section class="max-w-3xl mx-auto px-6 pt-16 pb-20">
  <h1 class="text-3xl md:text-4xl font-bold text-white">Blog</h1>
  <p class="mt-3 text-slate-400 text-lg">Security insights, audit walkthroughs, and product updates.</p>

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
// 6. Write everything.
// ---------------------------------------------------------------------------
const summary = posts.map((p, i) => `  ${String(i + 1).padStart(2)}. /blog/${p.slug}  (${p.dateText})`).join("\n");
if (CHECK) {
  console.log(`Parsed ${posts.length} posts from ${SRC}:`);
  console.log(summary);
  const missing = posts.filter((p) => !meta.has(p.slug)).map((p) => p.slug);
  if (missing.length) console.log(`\nNote: no JSON-LD description for: ${missing.join(", ")} (excerpt derived from intro).`);
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });
const toCrlf = (s) => s.replace(/\r?\n/g, "\r\n"); // match repo's CRLF HTML convention
posts.forEach((p, i) => {
  const prev = posts[i - 1]; // newer
  const next = posts[i + 1]; // older
  // prev/next as reading order: previous = newer post, next = older post.
  writeFileSync(join(OUT_DIR, `${p.slug}.html`), toCrlf(renderPost(p, prev, next)), "utf8");
});
writeFileSync(resolve(ROOT, "blog.html"), toCrlf(renderIndex()), "utf8");
console.log(`Wrote ${posts.length} post pages to blog/ and rewrote blog.html as an index.`);
console.log(summary);
