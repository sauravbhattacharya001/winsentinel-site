#!/usr/bin/env node
// Generate a per-post Open Graph image for every blog post, so each post unfurls
// on Twitter/LinkedIn/Slack/Discord with its OWN title instead of the generic
// /og/blog.png card. The /vs/ comparison pages already have per-page OG images;
// this gives blog posts the same treatment.
//
// What it does, for each blog/<slug>.html (skipping _partials):
//   1. Reads the post's BlogPosting JSON-LD (headline = source of truth) + <time>.
//   2. Writes og/blog-<slug>.svg — a 1200x630 card in the house style
//      (dark gradient + shield watermark + accent bar) with the title word-wrapped
//      and a date / "winsentinel.ai/blog" footer. Idempotent: same input -> same SVG.
//   3. Rewrites that post's og:image, twitter:image, and JSON-LD "image" to point at
//      /og/blog-<slug>.png (the PNG that scripts/generate-og-images.js rasterizes
//      from the SVG).
//
// After running this, run scripts/generate-og-images.js to (re)rasterize every
// og/*.svg -> og/*.png (including the new per-post ones), then commit + deploy.
//
// Usage:
//   node scripts/build-blog-og.mjs            # write SVGs + rewrite post meta tags
//   node scripts/build-blog-og.mjs --check    # report only, write nothing (CI guard)
//
// No external deps (SVG is generated as text; rasterization is generate-og-images.js's job).

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BLOG_DIR = resolve(ROOT, "blog");
const OG_DIR = resolve(ROOT, "og");
const ORIGIN = "https://winsentinel.ai";
const CHECK = process.argv.includes("--check");

const stripTags = (s) => String(s ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
// Escape text destined for an XML/SVG text node.
const escXml = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

// ---------------------------------------------------------------------------
// Word-wrap a title into at most `maxLines` lines, each <= `maxChars` chars.
// Greedy by words; if the last allowed line still overflows it is ellipsized so
// the card never spills past its safe area. Returns an array of line strings.
// ---------------------------------------------------------------------------
function wrapTitle(title, maxChars, maxLines) {
  const words = String(title).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const candidate = cur ? `${cur} ${w}` : w;
    if (candidate.length <= maxChars || !cur) {
      cur = candidate;
    } else {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  // Anything not consumed yet is appended to the final line then ellipsized.
  const consumed = lines.join(" ").split(/\s+/).filter(Boolean).length;
  if (consumed < words.length) {
    let last = lines[maxLines - 1] ?? "";
    const rest = words.slice(consumed).join(" ");
    last = (last ? `${last} ${rest}` : rest);
    if (last.length > maxChars) last = last.slice(0, maxChars - 1).trimEnd() + "…";
    lines[maxLines - 1] = last;
  }
  return lines.slice(0, maxLines);
}

// ---------------------------------------------------------------------------
// Render the per-post OG SVG. Mirrors the dark-gradient + shield watermark +
// accent-bar look of the existing og/vs-*.svg cards so the brand stays consistent.
// ---------------------------------------------------------------------------
function renderOgSvg({ title, dateText }) {
  // Title block: large font, up to 3 lines, vertically centered as a group.
  const lines = wrapTitle(title, 30, 3);
  const fontSize = lines.length >= 3 ? 60 : lines.length === 2 ? 66 : 72;
  const lineHeight = fontSize + 16;
  const blockHeight = (lines.length - 1) * lineHeight;
  const startY = 300 - blockHeight / 2; // center the title group around y=300
  const titleTspans = lines
    .map((ln, i) => `    <tspan x="100" y="${startY + i * lineHeight}">${escXml(ln)}</tspan>`)
    .join("\n");

  const footerDate = dateText ? `${escXml(dateText)}  ·  ` : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#070a11"/>
      <stop offset="100%" stop-color="#0b0f17"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <!-- shield watermark, lower-right, same motif as the /vs/ cards -->
  <path d="M980 300 880 340v110c0 90 60 150 150 175 90-25 150-85 150-175V340l-100-40z" fill="#38bdf8" opacity="0.07"/>
  <!-- eyebrow -->
  <text x="100" y="120" font-family="Inter, system-ui, sans-serif" font-size="26" font-weight="700" letter-spacing="2" fill="#38bdf8">WINSENTINEL BLOG</text>
  <!-- title (word-wrapped, left-aligned) -->
  <text font-family="Inter, system-ui, sans-serif" font-size="${fontSize}" font-weight="800" fill="#ffffff">
${titleTspans}
  </text>
  <!-- footer: date + canonical home -->
  <text x="100" y="560" font-family="Inter, system-ui, sans-serif" font-size="24" fill="#94a3b8">${footerDate}winsentinel.ai/blog</text>
  <!-- accent bar -->
  <rect x="0" y="610" width="1200" height="20" fill="#38bdf8" opacity="0.3"/>
</svg>
`;
}

// ---------------------------------------------------------------------------
// Rewrite the three image references in a post's HTML to the per-post PNG.
// Only rewrites when the current value differs, so the run is idempotent.
// ---------------------------------------------------------------------------
function rewritePostImages(html, slug) {
  const pngUrl = `${ORIGIN}/og/blog-${slug}.png`;
  let out = html;
  out = out.replace(
    /(<meta property="og:image" content=")[^"]*(" \/>)/,
    `$1${pngUrl}$2`
  );
  out = out.replace(
    /(<meta name="twitter:image" content=")[^"]*(" \/>)/,
    `$1${pngUrl}$2`
  );
  // JSON-LD "image": "...."  (with or without trailing comma)
  out = out.replace(
    /("image":\s*")https:\/\/winsentinel\.ai\/og\/[^"]*(")/,
    `$1${pngUrl}$2`
  );
  return out;
}

// ---------------------------------------------------------------------------
// Run.
// ---------------------------------------------------------------------------
const toCrlf = (s) => s.replace(/\r?\n/g, "\r\n"); // SVGs + HTML use the repo's CRLF convention

const files = readdirSync(BLOG_DIR).filter((f) => f.endsWith(".html") && !f.startsWith("_"));
if (!files.length) {
  console.error("No post pages found in blog/. Nothing to do.");
  process.exit(1);
}

let svgWritten = 0, svgUnchanged = 0, htmlRewritten = 0, skipped = 0;

for (const file of files) {
  const slug = file.replace(/\.html$/, "");
  const postPath = join(BLOG_DIR, file);
  const html = readFileSync(postPath, "utf8");

  const ldM = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!ldM) { console.error(`! ${file}: no JSON-LD block — skipping.`); skipped++; continue; }
  let ld;
  try { ld = JSON.parse(ldM[1]); } catch (e) {
    console.error(`! ${file}: invalid JSON-LD (${e.message}) — skipping.`); skipped++; continue;
  }
  const title = stripTags(ld.headline) || slug;
  const timeM = html.match(/<time[^>]*>([\s\S]*?)<\/time>/);
  const dateText = timeM ? stripTags(timeM[1]) : (ld.datePublished || "");

  // 1. SVG
  const svgPath = join(OG_DIR, `blog-${slug}.svg`);
  const svg = toCrlf(renderOgSvg({ title, dateText }));
  const svgExists = existsSync(svgPath);
  const svgChanged = !svgExists || readFileSync(svgPath, "utf8") !== svg;
  if (svgChanged) {
    if (!CHECK) writeFileSync(svgPath, svg, "utf8");
    svgWritten++;
  } else {
    svgUnchanged++;
  }

  // 2. HTML meta tags
  const updated = rewritePostImages(html, slug);
  if (updated !== html) {
    if (!CHECK) writeFileSync(postPath, updated, "utf8");
    htmlRewritten++;
  }
}

if (CHECK) {
  console.log(`[check] ${files.length} posts: ${svgWritten} SVG would be written, ${svgUnchanged} unchanged, ${htmlRewritten} HTML meta block(s) would change, ${skipped} skipped.`);
  if (svgWritten || htmlRewritten) {
    console.error("Per-post OG images/meta are stale. Run: node scripts/build-blog-og.mjs && node scripts/generate-og-images.js");
    process.exit(1);
  }
  process.exit(0);
}

console.log(`Per-post OG: ${svgWritten} SVG written, ${svgUnchanged} unchanged; ${htmlRewritten} post(s) re-pointed at their own OG image; ${skipped} skipped.`);
console.log(`Next: node scripts/generate-og-images.js  (rasterize og/*.svg -> og/*.png), then commit + deploy.`);
