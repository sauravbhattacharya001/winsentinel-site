# winsentinel-waitlist (Cloudflare Worker)

Captures email signups from the WinSentinel landing page.

## Endpoints

- `POST /signup` — body `{ "email": "you@example.com", "source": "landing-hero" }` → `{ ok: true, already: false }`
- `GET  /count`  — `{ count: 42 }` (public, used by the landing page to show momentum)
- `GET  /healthz` — `ok`

CORS is locked to `ALLOWED_ORIGIN` (default `https://winsentinel.ai`).
Per-IP rate limit: 5 signups / 10 min, stored in KV with TTL.

## One-time setup

```powershell
cd workers/waitlist
npm install
npx wrangler login

# Create KV namespaces (production + preview)
npx wrangler kv:namespace create WAITLIST
npx wrangler kv:namespace create WAITLIST --preview

# Paste both ids into wrangler.toml (id + preview_id under [[kv_namespaces]])
```

### Optional secrets

```powershell
# Cloudflare Turnstile (recommended once site has visible captcha widget)
npx wrangler secret put TURNSTILE_SECRET

# Slack/Discord webhook for new-signup pings
npx wrangler secret put SLACK_WEBHOOK_URL
```

## Deploy

```powershell
npx wrangler deploy
```

After first deploy, in the Cloudflare dashboard:

1. **Workers & Pages → winsentinel-waitlist → Settings → Triggers → Custom Domains**
2. Add `api.winsentinel.ai`
3. Cloudflare auto-creates the DNS record (proxied/orange-cloud is correct here — Worker only, not GitHub Pages).

## Local dev

```powershell
npx wrangler dev
# POST http://127.0.0.1:8787/signup  Content-Type: application/json  { "email": "x@y.z" }
```

## Inspecting signups

```powershell
# Total count
curl https://api.winsentinel.ai/count

# Dump all signups (paginated)
npx wrangler kv:key list --binding WAITLIST --prefix "email:"
npx wrangler kv:key get --binding WAITLIST "email:you@example.com"
```
