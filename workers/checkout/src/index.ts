/**
 * WinSentinel Checkout Worker
 *
 * Endpoints:
 *   POST /create-session   { plan: "pro_monthly" | "pro_annual" | "team_monthly" | "team_annual", email?: string }
 *                          -> { url: string } (Stripe Checkout redirect URL)
 *   POST /portal-session   { email?: string, customer_id?: string, licenseKey?: string }
 *   POST /v1/portal        (alias for /portal-session)
 *                          -> { url: string } (Stripe Billing Portal redirect URL)
 *   POST /webhook          Stripe webhook handler (checkout.session.completed)
 *   GET  /health           -> { ok: true }
 *
 * Secrets (wrangler secret put):
 *   STRIPE_SECRET_KEY      - sk_test_... only
 *   STRIPE_WEBHOOK_SECRET  - whsec_...
 */

interface Env {
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PUBLISHABLE_KEY: string;
  SUCCESS_URL: string;
  CANCEL_URL: string;
}

// Price IDs mapped per plan (set these after creating products in Stripe Dashboard)
const PRICE_IDS: Record<string, string> = {
  pro_monthly: "price_PLACEHOLDER_pro_monthly",   // $29/mo
  pro_annual: "price_PLACEHOLDER_pro_annual",     // $290/yr
  team_monthly: "price_PLACEHOLDER_team_monthly", // $79/mo
  team_annual: "price_PLACEHOLDER_team_annual",   // $990/yr
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(request);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      switch (`${request.method} ${url.pathname}`) {
        case "GET /health":
          return json({ ok: true }, 200, cors);
        case "POST /create-session":
          return handleCreateSession(request, env, cors);
        case "POST /portal-session":
          return handlePortalSession(request, env, cors);
        case "POST /v1/portal":
          return handlePortalSession(request, env, cors);
        case "POST /webhook":
          return handleWebhook(request, env);
        default:
          return json({ error: "not_found" }, 404, cors);
      }
    } catch (e: any) {
      console.error("checkout worker error:", e);
      return json({ error: "internal_error", message: e?.message }, 500, cors);
    }
  },
};

async function handleCreateSession(
  request: Request,
  env: Env,
  cors: Record<string, string>
): Promise<Response> {
  const body = await request.json<{ plan?: string; email?: string }>();
  const plan = body?.plan;

  if (!plan || !PRICE_IDS[plan]) {
    return json(
      { error: "invalid_plan", valid: Object.keys(PRICE_IDS) },
      400,
      cors
    );
  }

  const priceId = PRICE_IDS[plan];

  // Create Stripe Checkout Session via API (no SDK needed in Worker)
  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("line_items[0][price]", priceId);
  params.set("line_items[0][quantity]", "1");
  params.set("success_url", `${env.SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`);
  params.set("cancel_url", env.CANCEL_URL);
  params.set("subscription_data[trial_period_days]", "14");

  if (body?.email) {
    params.set("customer_email", body.email);
  }

  const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const session = await resp.json<{ url?: string; error?: any }>();

  if (!resp.ok || !session.url) {
    console.error("Stripe error:", JSON.stringify(session));
    return json({ error: "stripe_error", detail: session.error?.message }, 502, cors);
  }

  return json({ url: session.url }, 200, cors);
}

async function handlePortalSession(
  request: Request,
  env: Env,
  cors: Record<string, string>
): Promise<Response> {
  const body = await request.json<{ email?: string; customer_id?: string; licenseKey?: string }>();

  if (!body?.email && !body?.customer_id) {
    return json(
      { error: "missing_identifier", message: "Provide email or customer_id" },
      400,
      cors
    );
  }

  // Look up customer by email if no customer_id provided
  // Note: licenseKey is accepted for future cross-reference but currently
  // we resolve via email → Stripe customer lookup
  let customerId = body.customer_id;
  if (!customerId && body.email) {
    const searchParams = new URLSearchParams();
    searchParams.set("email", body.email);
    searchParams.set("limit", "1");

    const searchResp = await fetch(
      `https://api.stripe.com/v1/customers/search?query=email:'${encodeURIComponent(body.email)}'`,
      {
        headers: {
          Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        },
      }
    );
    const searchResult = await searchResp.json<{ data?: Array<{ id: string }> }>();
    if (!searchResult.data?.length) {
      return json(
        { error: "customer_not_found", message: "No subscription found for this email" },
        404,
        cors
      );
    }
    customerId = searchResult.data[0].id;
  }

  // Create Stripe Billing Portal session
  const params = new URLSearchParams();
  params.set("customer", customerId!);
  params.set("return_url", "https://winsentinel.ai/portal");

  const resp = await fetch(
    "https://api.stripe.com/v1/billing_portal/sessions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    }
  );

  const session = await resp.json<{ url?: string; error?: any }>();

  if (!resp.ok || !session.url) {
    console.error("Stripe portal error:", JSON.stringify(session));
    return json(
      { error: "stripe_error", detail: session.error?.message },
      502,
      cors
    );
  }

  return json({ url: session.url }, 200, cors);
}

async function handleWebhook(request: Request, env: Env): Promise<Response> {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return json({ error: "missing_signature" }, 400);
  }

  const payload = await request.text();

  // Verify webhook signature using Stripe's scheme
  const verified = await verifyStripeSignature(
    payload,
    signature,
    env.STRIPE_WEBHOOK_SECRET
  );

  if (!verified) {
    return json({ error: "invalid_signature" }, 401);
  }

  const event = JSON.parse(payload);

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    console.log(
      `✅ Checkout completed: ${session.customer_email} — subscription ${session.subscription}`
    );
    // TODO: Call license-worker /v1/admin/issue to generate license key
    // TODO: Send welcome email via Resend with license key
  }

  return json({ received: true }, 200);
}

// --- Stripe webhook signature verification (HMAC-SHA256) ---

async function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string
): Promise<boolean> {
  const parts = header.split(",").reduce(
    (acc, part) => {
      const [k, v] = part.split("=");
      if (k === "t") acc.timestamp = v;
      if (k === "v1") acc.signatures.push(v);
      return acc;
    },
    { timestamp: "", signatures: [] as string[] }
  );

  if (!parts.timestamp || parts.signatures.length === 0) return false;

  // Tolerance: 5 minutes
  const age = Math.abs(Date.now() / 1000 - Number(parts.timestamp));
  if (age > 300) return false;

  const signedPayload = `${parts.timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signedPayload)
  );
  const expected = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return parts.signatures.some((s) => timingSafeEqual(s, expected));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// --- Helpers ---

function json(body: object, status: number, headers?: Record<string, string>): Response {
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
