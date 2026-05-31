# WinSentinel Checkout Worker

Cloudflare Worker that creates Stripe Checkout sessions for WinSentinel Pro subscriptions.

## Setup

1. Create products/prices in Stripe Dashboard (test mode)
2. Update `PRICE_IDS` in `src/index.ts` with real price IDs
3. Set secrets:
   ```bash
   wrangler secret put STRIPE_SECRET_KEY    # sk_test_...
   wrangler secret put STRIPE_WEBHOOK_SECRET # whsec_...
   ```
4. Deploy: `wrangler deploy`
5. Add Stripe webhook endpoint pointing to `https://checkout.winsentinel.ai/webhook`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/create-session` | Creates Stripe Checkout session, returns `{ url }` |
| POST | `/webhook` | Stripe webhook (checkout.session.completed) |
| GET | `/health` | Health check |

## Plans

- `pro_monthly` — $29/mo (up to 25 nodes)
- `pro_annual` — $290/yr (17% off)
- `team_monthly` — $79/mo (up to 100 nodes)
- `team_annual` — $990/yr

All plans include a 14-day free trial.
