/** Dev helper: prints a quick state summary of the operational tables.  pnpm --filter @waypoint/db inspect */
import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { closeDb, createDb } from "./client";

config({ path: "../../.env" });

async function main() {
  const db = createDb();
  const q = async (label: string, s: ReturnType<typeof sql>) => console.log(label, JSON.stringify((await db.execute(s)).rows));
  await q("plans", sql`select depot_id, run_date, version, status from plans order by run_date, version`);
  await q("orders", sql`select run_date, status, count(*)::int from orders where run_date >= '2025-12-22' group by 1, 2 order by 1, 2`);
  await q("notifications", sql`select type, count(*)::int from notifications group by 1`);
  await q("outbox", sql`select topic, count(*)::int, count(relayed_at)::int as relayed from outbox group by 1`);
  await q("trips", sql`select status, count(*)::int from trips group by 1`);
  await closeDb(db);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
