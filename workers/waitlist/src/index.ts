/**
 * WinSentinel waitlist Worker.
 *
 * Endpoints:
 *   POST /signup      { email: string, source?: string, turnstileToken?: string }
 *   GET  /count       -> { count: number }   (public, total signups)
 *   GET  /list        -> { signups: [...], cursor: string|null }
 *                        Requires header `Authorization: Bearer <ADMIN_TOKEN>`.
 *                        Query: ?limit=100&cursor=<opaque>  (limit 1..1000, default 100)
 *   GET  /healthz     -> "ok"
 *
 * Storage: Cloudflare KV (binding: WAITLIST).
 *   key:  email:<lowercased-email>   value: JSON { email, source, ts, ip, ua }
 *   key:  meta:count                 value: integer string
 *
 * Hardening:
 *   - CORS locked to ALLOWED_ORIGIN.
 *   - Per-IP rate limit: 5 signups / 10 min via KV with TTL.
 *   - Email regex + length cap.
 *   - Optional Cloudflare Turnstile verification (TURNSTILE_SECRET).
 *   - Optional Slack/Discord webhook ping on new signup (SLACK_WEBHOOK_URL).
 */

export interface Env {
  WAITLIST: KVNamespace;
  ALLOWED_ORIGIN: string;
  TURNSTILE_SECRET?: string;
  SLACK_WEBHOOK_URL?: string;
  ADMIN_TOKEN?: string;
}

const EMAIL_KEY_PREFIX = "email:";
const LIST_DEFAULT_LIMIT = 100;
const LIST_MAX_LIMIT = 1000;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authorize(req: Request, env: Env): boolean {
  if (!env.ADMIN_TOKEN) return false;
  const header = req.headers.get("Authorization") || "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  return timingSafeEqual(m[1].trim(), env.ADMIN_TOKEN);
}

async function handleList(req: Request, env: Env): Promise<Response> {
  if (!env.ADMIN_TOKEN) return json({ error: "admin_disabled" }, 503, env);
  if (!authorize(req, env)) return json({ error: "unauthorized" }, 401, env);

  const url = new URL(req.url);
  const limitRaw = parseInt(url.searchParams.get("limit") || "", 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(LIST_MAX_LIMIT, limitRaw))
    : LIST_DEFAULT_LIMIT;
  const cursor = url.searchParams.get("cursor") || undefined;

  const page = await env.WAITLIST.list({ prefix: EMAIL_KEY_PREFIX, limit, cursor });
  const signups = await Promise.all(
    page.keys.map(async (k) => {
      const raw = await env.WAITLIST.get(k.name);
      try {
        return raw ? JSON.parse(raw) : { email: k.name.slice(EMAIL_KEY_PREFIX.length) };
      } catch {
        return { email: k.name.slice(EMAIL_KEY_PREFIX.length), parse_error: true };
      }
    })
  );

  const nextCursor = page.list_complete ? null : page.cursor || null;
  return json({ signups, cursor: nextCursor, count: signups.length }, 200, env);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LEN = 254; // RFC 5321
const MAX_SOURCE_LEN = 64;
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_SECONDS = 10 * 60;

function corsHeaders(env: Env): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body: unknown, status: number, env: Env): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(env),
    },
  });
}

async function verifyTurnstile(token: string, secret: string, ip: string): Promise<boolean> {
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
    });
    const data = (await res.json()) as { success?: boolean };
    return !!data.success;
  } catch {
    return false;
  }
}

async function rateLimit(env: Env, ip: string): Promise<boolean> {
  if (!ip) return true; // unknown IP: don't block
  const key = `rl:${ip}`;
  const raw = await env.WAITLIST.get(key);
  const count = raw ? parseInt(raw, 10) || 0 : 0;
  if (count >= RATE_LIMIT_MAX) return false;
  await env.WAITLIST.put(key, String(count + 1), { expirationTtl: RATE_LIMIT_WINDOW_SECONDS });
  return true;
}

async function bumpCount(env: Env): Promise<number> {
  const raw = await env.WAITLIST.get("meta:count");
  const next = (raw ? parseInt(raw, 10) || 0 : 0) + 1;
  await env.WAITLIST.put("meta:count", String(next));
  return next;
}

async function notifyWebhook(env: Env, email: string, source: string, total: number): Promise<void> {
  if (!env.SLACK_WEBHOOK_URL) return;
  try {
    await fetch(env.SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `🛡️ New WinSentinel waitlist signup: \`${email}\` (source: \`${source || "direct"}\`, total: ${total})`,
      }),
    });
  } catch {
    // swallow — webhook failures must not break signup
  }
}

async function handleSignup(req: Request, env: Env): Promise<Response> {
  const ip = req.headers.get("CF-Connecting-IP") || "";
  const ua = (req.headers.get("User-Agent") || "").slice(0, 256);

  let body: { email?: unknown; source?: unknown; turnstileToken?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400, env);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const source = typeof body.source === "string" ? body.source.slice(0, MAX_SOURCE_LEN) : "";
  const turnstileToken = typeof body.turnstileToken === "string" ? body.turnstileToken : "";

  if (!email || email.length > MAX_EMAIL_LEN || !EMAIL_RE.test(email)) {
    return json({ error: "invalid_email" }, 400, env);
  }

  if (env.TURNSTILE_SECRET) {
    if (!turnstileToken) return json({ error: "captcha_required" }, 400, env);
    const ok = await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET, ip);
    if (!ok) return json({ error: "captcha_failed" }, 400, env);
  }

  if (!(await rateLimit(env, ip))) {
    return json({ error: "rate_limited" }, 429, env);
  }

  const key = `email:${email}`;
  const existing = await env.WAITLIST.get(key);
  if (existing) {
    return json({ ok: true, already: true }, 200, env);
  }

  const record = { email, source, ts: new Date().toISOString(), ip, ua };
  await env.WAITLIST.put(key, JSON.stringify(record));
  const total = await bumpCount(env);
  await notifyWebhook(env, email, source, total);

  return json({ ok: true, already: false }, 200, env);
}

async function handleCount(env: Env): Promise<Response> {
  const raw = await env.WAITLIST.get("meta:count");
  const count = raw ? parseInt(raw, 10) || 0 : 0;
  return json({ count }, 200, env);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    if (url.pathname === "/healthz") {
      return new Response("ok", { status: 200, headers: corsHeaders(env) });
    }

    if (req.method === "POST" && url.pathname === "/signup") {
      return handleSignup(req, env);
    }

    if (req.method === "GET" && url.pathname === "/count") {
      return handleCount(env);
    }

    if (req.method === "GET" && url.pathname === "/list") {
      return handleList(req, env);
    }

    return json({ error: "not_found" }, 404, env);
  },
};
