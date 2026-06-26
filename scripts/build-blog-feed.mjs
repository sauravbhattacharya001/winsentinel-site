#!/usr/bin/env node
// Generate the blog's Atom 1.0 feed at blog/feed.xml from the per-post pages
// under blog/*.html. Post pages are the source of truth (same BlogPosting
// JSON-LD + <time> label that build-blog-index.mjs reads), so the feed never
// drifts from the index. Run after adding/removing a post:
//
//   node scripts/build-blog-feed.mjs
//   node scripts/build-blog-feed.mjs --check   # report only, write nothing
//
// No external deps. Idempotent: running twice produces no diff (the feed's
// <updated> is derived from the newest post's date, not the wall clock).

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BLOG_DIR = resolve(ROOT, "blog");
const ORIGIN = "https://winsentinel.ai";
const FEED_PATH = resolve(BLOG_DIR, "feed.xml");
const CHECK = process.argv.includes("--check");

const stripTags = (s) => String(s ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const escXml = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

// A YYYY-MM-DD date -> RFC 3339 timestamp at UTC midnight (Atom requires a full
// dateTime). Falls back to the epoch for an unparseable/missing date.
function toRfc3339(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate ?? ""));
  if (!m) return "1970-01-01T00:00:00Z";
  return `${m[1]}-${m[2]}-${m[3]}T00:00:00Z`;
}

// Mirror build-blog-index.mjs loadPosts(): read each post page, parse its
// BlogPosting JSON-LD, sort newest-first with a slug tie-break.
function loadPosts() {
  const files = readdirSync(BLOG_DIR).filter((f) => f.endsWith(".html") && !f.startsWith("_"));
  const posts = [];
  for (const file of files) {
    const slug = file.replace(/\.html$/, "");
    const html = readFileSync(join(BLOG_DIR, file), "utf8");
    const ldM = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    if (!ldM) {
      console.error(`! ${file}: no JSON-LD block - skipping.`);
      continue;
    }
    let ld;
    try {
      ld = JSON.parse(ldM[1]);
    } catch (e) {
      console.error(`! ${file}: invalid JSON-LD (${e.message}) - skipping.`);
      continue;
    }
    posts.push({
      slug,
      title: stripTags(ld.headline) || slug,
      published: ld.datePublished || "",
      updated: ld.dateModified || ld.datePublished || "",
      description: stripTags(ld.description),
    });
  }
  posts.sort(
    (a, b) => (b.published || "").localeCompare(a.published || "") || a.slug.localeCompare(b.slug)
  );
  return posts;
}

function renderFeed(posts) {
  // Feed <updated> = newest post's modified date (stable, not wall-clock).
  const feedUpdated = posts.length ? toRfc3339(posts[0].updated) : "1970-01-01T00:00:00Z";

  const entries = posts
    .map((p) => {
      const url = `${ORIGIN}/blog/${p.slug}`;
      return `  <entry>
    <title>${escXml(p.title)}</title>
    <link rel="alternate" type="text/html" href="${url}" />
    <id>${url}</id>
    <published>${toRfc3339(p.published)}</published>
    <updated>${toRfc3339(p.updated)}</updated>
    <author><name>Saurav Bhattacharya</name></author>
    <summary type="text">${escXml(p.description)}</summary>
  </entry>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>WinSentinel Blog</title>
  <subtitle>Security tips, audit walkthroughs, and product updates for Windows security professionals.</subtitle>
  <link rel="self" type="application/atom+xml" href="${ORIGIN}/blog/feed.xml" />
  <link rel="alternate" type="text/html" href="${ORIGIN}/blog" />
  <id>${ORIGIN}/blog</id>
  <updated>${feedUpdated}</updated>
  <author><name>Saurav Bhattacharya</name></author>
  <icon>${ORIGIN}/og/default.svg</icon>
${entries}
</feed>
`;
}

// HTML/XML in this repo uses CRLF line endings; match it so the diff stays clean.
const toCrlf = (s) => s.replace(/\r?\n/g, "\r\n");

const posts = loadPosts();
if (!posts.length) {
  console.error("No post pages found in blog/. Nothing to do.");
  process.exit(1);
}

const feedXml = toCrlf(renderFeed(posts));
let current = "";
try {
  current = readFileSync(FEED_PATH, "utf8");
} catch {
  /* feed does not exist yet */
}
const changed = current !== feedXml;

if (CHECK) {
  console.log(`${posts.length} posts (newest: ${posts[0].slug} @ ${posts[0].published}).`);
  console.log(`Would ${changed ? "rewrite" : "leave"} blog/feed.xml.`);
  process.exit(0);
}

if (changed) writeFileSync(FEED_PATH, feedXml, "utf8");
console.log(`Atom feed ${changed ? "written" : "unchanged"} (${posts.length} entries) -> blog/feed.xml`);
