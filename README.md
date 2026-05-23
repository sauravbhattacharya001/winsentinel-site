# winsentinel-site

Marketing site for [WinSentinel](https://github.com/sauravbhattacharya001/WinSentinel) — deployed at **https://winsentinel.ai**.

## Stack

Single-file static site (`index.html`) using Tailwind CDN. No build step. Deployed via GitHub Pages from `main`.

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

## Roadmap

- [x] Static landing page (hero / features / pricing / install / waitlist)
- [ ] Wire waitlist form to real endpoint (Cloudflare Worker + KV, or ConvertKit)
- [ ] `/pricing` deep-link page once tiers stabilize
- [ ] Blog / changelog feed pulling from the WinSentinel repo releases
