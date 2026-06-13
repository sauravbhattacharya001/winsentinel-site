#!/usr/bin/env node
// Scaffold a new blog post page under blog/<slug>.html with all the SEO plumbing
// (title, canonical, OG article card, Twitter card, BlogPosting JSON-LD, shared
// nav.js include), then rebuild the index + prev/next nav so it shows up at /blog.
//
// You only write the title, a one-line summary, and the body. Everything else is
// generated to match the existing posts.
//
// Usage:
//   node scripts/new-post.mjs --title "How To Harden Windows Defender" \
//        --summary "A practical walkthrough of the registry keys and GPOs that matter." \
//        [--slug harden-windows-defender] [--date 2026-06-13] [--force]
//
// Then edit the BODY section of the generated file and re-run:
//   node scripts/build-blog-index.mjs
// (the summary you pass also becomes the meta description + index excerpt.)
//
// No external deps.

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BLOG_DIR = resolve(ROOT, "blog");
const ORIGIN = "https://winsentinel.ai";

// ---- args ----------------------------------------------------------------
function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}
const hasFlag = (name) => process.argv.includes(`--${name}`);

const title = arg("title");
const summary = arg("summary") || "";
const force = hasFlag("force");
if (!title) {
  console.error('Usage: node scripts/new-post.mjs --title "Post Title" --summary "One-line summary." [--slug my-slug] [--date YYYY-MM-DD] [--force]');
  process.exit(1);
}

const slugify = (s) => s.toLowerCase()
  .replace(/[''`]/g, "")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 60);
const slug = (arg("slug") ? slugify(arg("slug")) : slugify(title));
if (!slug) { console.error("Could not derive a slug. Pass --slug."); process.exit(1); }

const iso = arg("date") || new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) { console.error(`--date must be YYYY-MM-DD (got "${iso}").`); process.exit(1); }
const dateText = new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

const outPath = join(BLOG_DIR, `${slug}.html`);
if (existsSync(outPath) && !force) {
  console.error(`Refusing to overwrite existing ${outPath} (pass --force to replace).`);
  process.exit(1);
}

const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---- reuse head boilerplate + favicon from an existing post --------------
const sample = readdirSync(BLOG_DIR).filter((f) => f.endsWith(".html") && !f.startsWith("_") && f !== `${slug}.html`)[0];
if (!sample) { console.error("No existing post to copy head boilerplate from."); process.exit(1); }
const sampleHtml = readFileSync(join(BLOG_DIR, sample), "utf8");
const twStart = sampleHtml.indexOf("<script>", sampleHtml.indexOf("tailwind.config") - 200);
const twEnd = sampleHtml.indexOf("</script>", twStart) + "</script>".length;
const stStart = sampleHtml.indexOf("<style>");
const stEnd = sampleHtml.indexOf("</style>", stStart) + "</style>".length;
const faviconM = sampleHtml.match(/<link rel="icon"[^>]*>/);
const HEAD_BOILERPLATE = `  <script src="https://cdn.tailwindcss.com"></script>
  ${sampleHtml.slice(twStart, twEnd)}
  ${sampleHtml.slice(stStart, stEnd)}`;
const FAVICON = faviconM ? faviconM[0] : "";

const url = `${ORIGIN}/blog/${slug}`;
const ld = {
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  "@id": url,
  "headline": title,
  "datePublished": iso,
  "dateModified": iso,
  "url": url,
  "mainEntityOfPage": url,
  "description": summary,
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

const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escAttr(title)} — WinSentinel Blog</title>
  <meta name="description" content="${escAttr(summary)}" />
  <meta name="theme-color" content="#0b0f17" />
  <meta name="author" content="Saurav Bhattacharya" />
  <meta property="og:title" content="${escAttr(title)}" />
  <meta property="og:description" content="${escAttr(summary)}" />
  <meta property="og:type" content="article" />
  <meta property="article:published_time" content="${iso}" />
  <meta property="og:url" content="${url}" />
  <meta property="og:image" content="${ORIGIN}/og/blog.png" />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content="${ORIGIN}/og/blog.png" />
  <meta name="twitter:title" content="${escAttr(title)}" />
  <meta name="twitter:description" content="${escAttr(summary)}" />
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
  <time class="mt-8 block text-xs text-slate-500 uppercase tracking-wider">${escAttr(dateText)}</time>
  <h1 class="mt-2 text-3xl md:text-4xl font-bold text-white leading-tight">${escAttr(title)}</h1>
  <p class="mt-4 text-lg text-slate-300">${escAttr(summary)}</p>

  <div class="prose mt-8">
    <!-- BODY: write the post here. Supported elements match the other posts:
         <h2>, <h3>, <p>, <ul><li>, <ol><li>, <pre><code>…</code></pre>,
         <strong>, <em>, <a href>, <blockquote>. -->
    <p>Write your post here.</p>
  </div>

  <nav class="mt-16 pt-8 border-t border-white/10 flex items-center justify-between gap-6 text-sm text-slate-400">
    <span></span>
    <span></span>
  </nav>
</article>

<div id="site-footer"></div>
<script src="/components/nav.js"></script>
</body>
</html>
`;

const toCrlf = (s) => s.replace(/\r?\n/g, "\r\n");
writeFileSync(outPath, toCrlf(page), "utf8");
console.log(`Created ${outPath}`);
console.log(`  title: ${title}`);
console.log(`  date:  ${iso} (${dateText})`);
console.log(`  url:   ${url}`);

// Wire it into the index + prev/next nav.
try {
  execFileSync(process.execPath, [resolve(ROOT, "scripts/build-blog-index.mjs")], { stdio: "inherit" });
} catch {
  console.error("Index rebuild failed — run: node scripts/build-blog-index.mjs");
}
console.log(`\nNext: edit the BODY in ${slug}.html, then commit (and re-run build-blog-index.mjs if you change the title/date/summary).`);
