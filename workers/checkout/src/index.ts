/**
 * WinSentinel Checkout Worker — DEPRECATED STUB (do not deploy)
 * ============================================================================
 *
 * This is NOT the worker that runs in production. The live checkout worker at
 * https://checkout.winsentinel.ai is the canonical implementation in the
 * private `winsentinel-pro` repo:
 *
 *     winsentinel-pro/packages/checkout-worker/src/worker.mjs
 *
 * That canonical worker handles the full money path correctly:
 *   - POST /create-session         Stripe Checkout session (per-plan pricing)
 *   - POST /create-portal-session  Stripe Billing Portal (customer portal)
 *   - POST /webhook                checkout.session.completed -> ISSUES the
 *                                  license via the license worker, records
 *                                  referral conversions, emails the key (Resend),
 *                                  and extends licenses on invoice.paid renewals,
 *                                  all behind a D1-backed idempotency gate.
 *   - GET  /config                 public pricing config
 *   - GET  /health                 health check
 *
 * Why this file is a stub
 * -----------------------
 * An earlier, INCOMPLETE copy of the checkout worker lived here. Its webhook
 * never issued a license (it had a `TODO: call license-worker`), it had no
 * idempotency gate, no renewal handling, and only placeholder Stripe price IDs.
 * Because BOTH this worker and the canonical one declared the Cloudflare Worker
 * name `winsentinel-checkout`, a `wrangler deploy` from this directory would
 * have OVERWRITTEN the working production worker with the broken one — i.e.
 * customers would be charged but never receive a license key.
 *
 * To make that mistake impossible, the real implementation was removed from
 * this repo (it is maintained in `winsentinel-pro`), `wrangler.toml` here was
 * renamed away from the production worker name, and the `deploy` script was
 * removed. What remains is a fail-safe stub: every real endpoint returns
 * 410 Gone pointing at the canonical worker, so if this is ever deployed by
 * mistake it fails LOUDLY and safely instead of silently breaking purchases.
 *
 * If you need to change checkout behaviour, edit
 * `winsentinel-pro/packages/checkout-worker/src/worker.mjs` — not this file.
 */

const CANONICAL = "https://checkout.winsentinel.ai";
const CANONICAL_SOURCE =
  "winsentinel-pro/packages/checkout-worker/src/worker.mjs";

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(request);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    // Health stays green so any uptime check pointed here still passes, but it
    // explicitly reports that this deployment is a deprecated stub.
    if (request.method === "GET" && url.pathname === "/health") {
      return json(
        { ok: true, deprecated: true, canonical: CANONICAL },
        200,
        cors
      );
    }

    // Everything else is intentionally gone. Do NOT process payments, create
    // Checkout/portal sessions, or accept webhooks from this stub — that work
    // belongs to the canonical worker. 410 makes a mistaken deploy obvious.
    return json(
      {
        error: "gone",
        message:
          "This is a deprecated stub. The live checkout worker runs at " +
          `${CANONICAL} (source: ${CANONICAL_SOURCE}).`,
        canonical: CANONICAL,
      },
      410,
      cors
    );
  },
};

function json(
  body: object,
  status: number,
  headers?: Record<string, string>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(headers || {}) },
  });
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin") || "https://winsentinel.ai";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
