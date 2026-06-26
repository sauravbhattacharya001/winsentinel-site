/*
 * WinSentinel — Cloudflare Web Analytics loader (privacy-friendly, cookieless).
 *
 * Why this file: Cloudflare Web Analytics is the site's chosen analytics
 * (no cookies, no cross-site tracking, explicitly NOT Google Analytics). Its
 * beacon needs a per-site token that comes from the Cloudflare dashboard
 * (Analytics & Logs → Web Analytics → your site → JS snippet). That token is a
 * human-gated value — it is intentionally NOT committed here.
 *
 * How it works: every page loads this script (one <script src> in <head>, see
 * scripts/add-analytics.py) and may set a token just before it:
 *
 *     <script>window.__WS_CF_BEACON_TOKEN__ = "<your-cloudflare-token>";</script>
 *     <script defer src="/js/cf-analytics.js"></script>
 *
 * If the token is absent, empty, or still the placeholder, this loader is a
 * complete no-op — it does NOT inject the beacon and makes ZERO network
 * requests, so the un-configured site stays clean (no 401/404 beacon noise) and
 * local previews never phone home. The instant a real token is dropped in (one
 * edit, see README "Analytics"), every page starts reporting.
 *
 * It also respects Do Not Track: if the visitor has DNT enabled we skip the
 * beacon entirely, in keeping with the cookieless / privacy-first posture.
 */
(function () {
  "use strict";

  var PLACEHOLDER = "__CF_BEACON_TOKEN__"; // sentinel value = "not configured yet"

  function honorDoNotTrack() {
    try {
      var dnt =
        (typeof navigator !== "undefined" &&
          (navigator.doNotTrack || navigator.msDoNotTrack)) ||
        (typeof window !== "undefined" && window.doNotTrack);
      return dnt === "1" || dnt === "yes";
    } catch (e) {
      return false;
    }
  }

  function resolveToken() {
    try {
      var t = window.__WS_CF_BEACON_TOKEN__;
      if (typeof t !== "string") return "";
      t = t.trim();
      if (!t || t === PLACEHOLDER) return "";
      return t;
    } catch (e) {
      return "";
    }
  }

  function loadBeacon(token) {
    // Mirror the official Cloudflare Web Analytics snippet, but inject it only
    // once we have a real token. data-cf-beacon carries the token as JSON.
    if (document.querySelector('script[src*="static.cloudflareinsights.com/beacon"]')) {
      return; // already injected (idempotent against double-loads)
    }
    var s = document.createElement("script");
    s.defer = true;
    s.src = "https://static.cloudflareinsights.com/beacon.min.js";
    s.setAttribute("data-cf-beacon", JSON.stringify({ token: token }));
    (document.head || document.documentElement).appendChild(s);
  }

  if (typeof document === "undefined") return; // SSR / non-browser guard
  if (honorDoNotTrack()) return;

  var token = resolveToken();
  if (!token) return; // not configured → no-op, no network request

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      loadBeacon(token);
    });
  } else {
    loadBeacon(token);
  }
})();
