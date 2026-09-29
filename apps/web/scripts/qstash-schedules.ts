/**
 * Creates (or replaces) the QStash schedules for a deployed app:
 *   APP_URL=https://waypoint.example.com pnpm --filter web jobs:schedule
 * QStash must be able to reach APP_URL, so this is for cloud deployments, not localhost.
 */
import { Client } from "@upstash/qstash";

const SCHEDULES = [{ id: "waypoint-relay", job: "relay", cron: "* * * * *" }];

async function main() {
  const base = process.env.APP_URL?.replace(/\/$/, "");
  const token = process.env.QSTASH_TOKEN;
  if (!base || !token) throw new Error("Set APP_URL and QSTASH_TOKEN");
  if (/localhost|127\.0\.0\.1/.test(base)) throw new Error("QStash cannot call localhost - use the deployed URL");
  const client = new Client({ token, baseUrl: process.env.QSTASH_URL });
  for (const s of SCHEDULES) {
    await client.schedules.create({ scheduleId: s.id, destination: `${base}/api/jobs/${s.job}`, cron: s.cron, retries: 3 });
    console.log(`scheduled ${s.id}: ${s.cron} -> ${base}/api/jobs/${s.job}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
