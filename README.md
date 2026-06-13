# winsentinel-site

Marketing site for [WinSentinel](https://github.com/sauravbhattacharya001/WinSentinel) — deployed at **https://winsentinel.ai**.

## Stack

Static site (no build step) using the Tailwind CDN. `index.html` is the landing page; `pricing.html`, `buy.html`, `fleet.html`, `portal.html`, `blog.html`, `changelog.html`, and the `vs/*.html` comparison pages are siblings. Deployed via GitHub Pages from `main`.

## Blog

The blog is **one page per post** under `blog/<slug>.html`; `blog.html` is a generated
index (cards sorted newest-first). Each post page carries its own `<title>`, canonical,
OpenGraph `article` card, and `BlogPosting` JSON-LD, so every article ranks and unfurls
on its own.

**Add a post:**

```pwsh
node scripts/new-post.mjs --title "How To Harden Windows Defender" `
  --summary "A practical walkthrough of the registry keys and GPOs that matter."
# optional: --slug harden-windows-defender  --date 2026-06-13
```

That scaffolds `blog/<slug>.html` (with all the SEO plumbing) and rebuilds the index +
prev/next nav. Then edit the `<!-- BODY -->` section of the new file, and regenerate the
sitemap:

```pwsh
python scripts/generate-sitemap.py
```

**Other tasks:**

- Changed a post's title/date/summary, or deleted a post? Re-run `node scripts/build-blog-index.mjs`.
- `scripts/split-blog.mjs` is the one-time migration that split the old monolithic
  `blog.html`; it refuses to run now that posts are separate files.

## Local preview

Any static server works:

```pwsh
python -m http.server 8080
# then open http://localhost:8080
```

## Deploy

Pushing to `main` triggers `.github/workflows/pages.yml`, which publishes the repo root to GitHub Pages. The `CNAME` file binds the site to `winsentinel.ai`.

DNS for `winsentinel.ai`:

- `A`     `@` → `185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153`
- `AAAA`  `@` → `2606:50c0:8000::153, 2606:50c0:8001::153, 2606:50c0:8002::153, 2606:50c0:8003::153`
- `CNAME` `www` → `sauravbhattacharya001.github.io.`

## Analytics

The site has **no analytics wired up** today, and **no tracking token is committed to this repo** (none should ever be — a Cloudflare Web Analytics JS token is a site-scoped secret).

To enable privacy-friendly, cookieless [Cloudflare Web Analytics](https://developers.cloudflare.com/web-analytics/) later, pick **one** of these — do not paste a token into the HTML in git:

1. **Automatic Setup (recommended, zero code).** Proxy `winsentinel.ai` through Cloudflare (orange-cloud the DNS record), then in the Cloudflare dashboard enable Web Analytics → *Automatic Setup* for the zone. Cloudflare injects the beacon at the edge, so nothing changes in this repo and no token is exposed. Note: this requires moving the apex record from the GitHub Pages `A`/`AAAA` records above to a Cloudflare-proxied `CNAME` to `sauravbhattacharya001.github.io`.
2. **JS Snippet (manual).** If you keep DNS pointed straight at GitHub Pages, use the snippet method instead: copy the beacon `<script>` from the dashboard and inject it **at deploy time** (e.g. a `pages.yml` step that substitutes the token from a GitHub Actions secret), never committing the literal token. The token is not sensitive in the "can leak your password" sense, but it is account-scoped configuration that does not belong in source control.

## Roadmap

- [x] Static landing page (hero / features / pricing / install / waitlist)
- [ ] Wire waitlist form to real endpoint (Cloudflare Worker + KV, or ConvertKit)
- [ ] `/pricing` deep-link page once tiers stabilize
- [x] Blog split into per-post pages with per-article SEO (see **Blog** above)
- [ ] Changelog feed pulling from the WinSentinel repo releases
- [ ] Wire up Cloudflare Web Analytics (see **Analytics** above) once apex DNS routing is decided
