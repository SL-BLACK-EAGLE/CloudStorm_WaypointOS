#!/usr/bin/env node
/**
 * One-time cloud setup from the root .env. Prints key names and outcomes only, never values.
 *
 *   node scripts/deploy-cloud.mjs                      # Vercel env + Convex secret + Neon migrate/seed
 *   node scripts/deploy-cloud.mjs --schedule https://cloudstorm-waypointos.vercel.app   # QStash schedule only
 *
 * Needs: `vercel link` done at the repo root, the CLIs logged in, seed-data/ present for the seed.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const web = join(root, "apps/web");

function readEnv(file) {
  const out = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    out[m[1]] = v;
  }
  return out;
}

const env = readEnv(join(root, ".env"));
const isLocal = (v) => /localhost|127\.0\.0\.1|host\.docker\.internal|:5433\b/.test(v);
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: root, stdio: ["pipe", "pipe", "pipe"], encoding: "utf8", shell: process.platform === "win32", ...opts });
const ok = (msg) => console.log(`  ✓ ${msg}`);
const warn = (msg) => console.log(`  ! ${msg}`);

const scheduleIdx = process.argv.indexOf("--schedule");
if (scheduleIdx > -1) {
  const appUrl = process.argv[scheduleIdx + 1];
  if (!appUrl?.startsWith("https://")) throw new Error("Pass the deployed https URL after --schedule");
  console.log("QStash schedule");
  const childEnv = { ...process.env, ...env, APP_URL: appUrl };
  if (isLocal(env.QSTASH_URL ?? "")) delete childEnv.QSTASH_URL; // the SDK then uses Upstash cloud
  const r = run("pnpm", ["--filter", "web", "exec", "tsx", "scripts/qstash-schedules.ts"], { env: childEnv });
  r.status === 0 ? ok(r.stdout.trim().split("\n").pop()) : warn(`failed: ${(r.stderr || r.stdout).trim().split("\n").pop()}`);
  process.exit(r.status ?? 1);
}

// ── 1. Vercel production environment
const VERCEL_KEYS = [
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_CLERK_SIGN_IN_URL",
  "NEXT_PUBLIC_CLERK_SIGN_UP_URL",
  "CLERK_WEBHOOK_SIGNING_SECRET",
  "CONVEX_DEPLOY_KEY",
  "CONVEX_SERVER_SECRET",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "QSTASH_URL",
  "QSTASH_TOKEN",
  "QSTASH_CURRENT_SIGNING_KEY",
  "QSTASH_NEXT_SIGNING_KEY",
  "DEMO_DATE",
];
const REQUIRED = ["DATABASE_URL", "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY", "CONVEX_DEPLOY_KEY", "CONVEX_SERVER_SECRET"];

console.log("Vercel environment (production)");
let blocked = false;
for (const key of VERCEL_KEYS) {
  const value = env[key];
  if (!value) {
    (REQUIRED.includes(key) ? warn : (m) => console.log(`  - ${m}`))(`${key} is empty in .env - not set`);
    if (REQUIRED.includes(key)) blocked = true;
    continue;
  }
  if (isLocal(value)) {
    warn(`${key} points at a local service - not sent (use the cloud value in .env)`);
    if (REQUIRED.includes(key)) blocked = true;
    continue;
  }
  const r = run("vercel", ["env", "add", key, "production", "--force"], { input: value }); // value via stdin, never argv
  r.status === 0 ? ok(key) : warn(`${key}: ${(r.stderr || r.stdout).trim().split("\n").pop()}`);
}
if (blocked) {
  console.log("\nFix the keys marked ! in .env and run this again. Nothing else was changed.");
  process.exit(1);
}

// ── 2. Convex Cloud: the relay mutation checks this shared secret
console.log("Convex Cloud");
{
  const convexBin = join(dirname(createRequire(join(web, "package.json")).resolve("convex/package.json")), "bin/main.js");
  const childEnv = { ...process.env, CONVEX_DEPLOY_KEY: env.CONVEX_DEPLOY_KEY };
  delete childEnv.CONVEX_SELF_HOSTED_URL;
  delete childEnv.CONVEX_SELF_HOSTED_ADMIN_KEY;
  const r = spawnSync(process.execPath, [convexBin, "env", "set", "CONVEX_SERVER_SECRET", env.CONVEX_SERVER_SECRET], { cwd: web, env: childEnv, encoding: "utf8" });
  r.status === 0 ? ok("CONVEX_SERVER_SECRET set on the deployment") : warn(`convex env set failed: ${(r.stderr || r.stdout).trim().split("\n").pop()}`);
}

// ── 3. Neon: migrate, then seed (writes the demo baseline and the four demo accounts)
console.log("Neon database");
if (isLocal(env.DATABASE_URL)) {
  warn("DATABASE_URL in .env is local - skipped migrate/seed");
} else {
  for (const [label, script] of [
    ["migrations applied", "db:migrate"],
    ["seeded from seed-data/ + demo baseline saved", "db:seed"],
  ]) {
    const r = run("pnpm", [script], { env: { ...process.env, ...env } });
    if (r.status !== 0) {
      warn(`${script} failed: ${(r.stderr || r.stdout).trim().split("\n").slice(-3).join(" | ")}`);
      process.exit(1);
    }
    ok(label);
  }
}

console.log("\nDone. Next: deploy (vercel deploy --prod), then run with --schedule <url> for the QStash relay.");
