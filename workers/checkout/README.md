# WinSentinel Checkout Worker — DEPRECATED STUB

> **Do not deploy this.** This directory no longer contains the real checkout
> worker — only a fail-safe stub.

The **live** checkout worker that powers `https://checkout.winsentinel.ai`
(used by `buy.html`, `pricing.html`, `fleet.html`, and `portal.html` on this
site) is the canonical implementation in the private **winsentinel-pro** repo:

```
winsentinel-pro/packages/checkout-worker/src/worker.mjs
```

## Why this is a stub

An earlier, incomplete copy of the checkout worker lived here. Its webhook
never issued a license (it had a `TODO: call license-worker`), it had no
idempotency gate, no subscription-renewal handling, and only placeholder Stripe
price IDs. Critically, it declared the **same** Cloudflare Worker name
(`winsentinel-checkout`) as the canonical worker, so a `wrangler deploy` from
this folder would have **overwritten the production worker** with the broken one
— customers would have been charged but never received a license key.

To make that impossible:

- `src/index.ts` is now a fail-safe stub: `/health` reports `deprecated: true`,
  and every other route returns **410 Gone** with a pointer to the canonical
  worker. If this is ever deployed by mistake, it fails loudly and safely
  instead of silently breaking purchases.
- `wrangler.toml` was renamed to `winsentinel-checkout-stub-do-not-deploy` so a
  deploy from here cannot clobber the production worker by name.
- The `deploy` script and the `stripe` dependency were removed.

## Where to make changes

Edit the canonical worker in **winsentinel-pro**, not this file:

```
winsentinel-pro/packages/checkout-worker/
```

That worker implements the full flow:

| Method | Path | Description |
|--------|------|-------------|
| POST | `/create-session` | Creates a Stripe Checkout session, returns `{ url }` |
| POST | `/create-portal-session` | Opens a Stripe Billing Portal session (customer portal) |
| POST | `/webhook` | `checkout.session.completed` → issues license, records referral, emails key; `invoice.paid` → extends license. Idempotency-gated. |
| GET | `/config` | Public pricing config |
| GET | `/health` | Health check |
