#!/usr/bin/env node
// build-security-txt.mjs - generate .well-known/security.txt (RFC 9116).
//
// security.txt is the standard, machine-readable way for a security vendor to
// advertise how to report a vulnerability. RFC 9116 REQUIRES an `Expires`
// field, and crawlers/scanners treat an expired file as invalid - so the date
// must not be a hand-maintained magic string that silently goes stale. This
// script regenerates the file with `Expires` set a fixed horizon (default 365
// days) into the future, and is wired into the Pages build so every deploy
// ships a fresh, non-expired policy.
//
// Usage:
//   node scripts/build-security-txt.mjs [out]        # default .well-known/security.txt
//   node scripts/build-security-txt.mjs --check       # CI: fail if expired/stale-shaped
//
// Env:
//   SECURITY_TXT_TTL_DAYS  - days until Expires (default 365)
//   SECURITY_TXT_NOW       - ISO instant to treat as "now" (tests/reproducible builds)

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), "..");
// Positional out path = first arg after the script that isn't a --flag.
const positional = process.argv.slice(2).find(a => !a.startsWith("--"));
const OUT = resolve(ROOT, positional || ".well-known/security.txt");
const CHECK = process.argv.includes("--check");

const SITE = "https://winsentinel.ai";
const REPO = "https://github.com/sauravbhattacharya001/WinSentinel";
const TTL_DAYS = Number(process.env.SECURITY_TXT_TTL_DAYS || 365);

function nowDate() {
  const v = process.env.SECURITY_TXT_NOW;
  const d = v ? new Date(v) : new Date();
  if (Number.isNaN(d.getTime())) throw new Error(`invalid SECURITY_TXT_NOW: ${v}`);
  return d;
}

// RFC 9116 wants an absolute ISO-8601 instant for Expires. Pin to midnight UTC
// so the value is stable within a day (no churn on every rebuild).
function expiresIso(now, days) {
  const e = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days, 0, 0, 0));
  return e.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function build(now) {
  const expires = expiresIso(now, TTL_DAYS);
  // Contacts mirror SECURITY.md exactly - GitHub private vulnerability
  // reporting (preferred) + the maintainer's GitHub profile contact. No
  // unmonitored mailbox is invented here.
  return [
    "# WinSentinel security contact and disclosure policy (RFC 9116).",
    "# Please report vulnerabilities responsibly - do not open a public issue.",
    "",
    `Contact: ${REPO}/security/advisories/new`,
    "Contact: https://github.com/sauravbhattacharya001",
    `Expires: ${expires}`,
    "Preferred-Languages: en",
    `Canonical: ${SITE}/.well-known/security.txt`,
    `Policy: ${REPO}/blob/main/SECURITY.md`,
    `Acknowledgments: ${REPO}/blob/main/SECURITY.md`,
    "",
  ].join("\n");
}

function expiresFromText(txt) {
  const m = txt.match(/^Expires:\s*(\S+)\s*$/m);
  return m ? new Date(m[1]) : null;
}

if (CHECK) {
  if (!existsSync(OUT)) {
    console.error(`FAIL security.txt missing: ${OUT}`);
    process.exit(1);
  }
  const txt = readFileSync(OUT, "utf8");
  const exp = expiresFromText(txt);
  const now = nowDate();
  if (!exp || Number.isNaN(exp.getTime())) {
    console.error("FAIL security.txt has no valid Expires field (RFC 9116 requires one)");
    process.exit(1);
  }
  if (exp.getTime() <= now.getTime()) {
    console.error(`FAIL security.txt Expires is in the past (${exp.toISOString()}); regenerate it`);
    process.exit(1);
  }
  // Warn (do not fail) if it expires within 30 days so a refresh can be queued.
  const days = (exp.getTime() - now.getTime()) / 86400000;
  if (days < 30) {
    console.log(`WARN security.txt expires in ${days.toFixed(0)} day(s) - regenerate soon.`);
  } else {
    console.log(`OK   security.txt valid (expires ${exp.toISOString()}, ${days.toFixed(0)} days).`);
  }
  process.exit(0);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, build(nowDate()), "utf8");
console.log(`Wrote ${OUT}`);
