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

The site uses **[Cloudflare Web Analytics](https://developers.cloudflare.com/web-analytics/)** — cookieless, privacy-friendly, and explicitly **not** Google Analytics. **No tracking token is committed to this repo** (none ever should be — a Web Analytics JS token is site-scoped account configuration).

The loader is already wired up on every page but stays **completely inert until a real token is configured**, so nothing reports (and no beacon request is made) until you opt in. How it works:

- `js/cf-analytics.js` is loaded in every page's `<head>` (injected by `scripts/add-analytics.py`). It reads `window.__WS_CF_BEACON_TOKEN__`. If that value is missing, empty, or still the placeholder `__CF_BEACON_TOKEN__`, the loader is a **no-op** — it injects no beacon and makes **zero** network requests. It also honors **Do Not Track**.
- The instant a real token is present, the loader injects Cloudflare's official `beacon.min.js` with that token and the site starts reporting.

**To go live** (after the token is minted in the Cloudflare dashboard → *Analytics & Logs → Web Analytics → your site → JS snippet*), pick **one**:

1. **Automatic Setup (zero code, recommended if the zone is proxied).** Orange-cloud `winsentinel.ai` through Cloudflare and enable Web Analytics → *Automatic Setup* for the zone. Cloudflare injects the beacon at the edge; the committed loader stays inert and harmless. (Requires moving the apex record from the GitHub Pages `A`/`AAAA` records to a Cloudflare-proxied `CNAME` → `sauravbhattacharya001.github.io`.)
2. **JS Snippet via the committed loader.** Replace the placeholder token on every page with the real one and re-run the injector — keeping DNS pointed straight at GitHub Pages:

   ```pwsh
   # Re-stamp every page's window.__WS_CF_BEACON_TOKEN__ with the real token.
   # (The injector is idempotent on the <script src> line; the token line is what changes.)
   python scripts/add-analytics.py --token "<your-cloudflare-token>"
   ```

   For a CI-driven flow that never commits the literal token, do the same substitution **at deploy time** (a `pages.yml` step that runs the injector with the token sourced from a GitHub Actions secret). The token is account-scoped config, not a password, but it still doesn't belong in source control.

To verify the loader is present on every page: `python scripts/add-analytics.py --check` (exit 0 = all pages wired).


## Roadmap

- [x] Static landing page (hero / features / pricing / install / waitlist)
- [ ] Wire waitlist form to real endpoint (Cloudflare Worker + KV, or ConvertKit)
- [ ] `/pricing` deep-link page once tiers stabilize
- [x] Blog split into per-post pages with per-article SEO (see **Blog** above)
- [ ] Changelog feed pulling from the WinSentinel repo releases
- [x] Wire up Cloudflare Web Analytics loader on every page (cookieless, inert until a token is set — see **Analytics** above); going live needs only the Cloudflare token / apex-DNS decision
