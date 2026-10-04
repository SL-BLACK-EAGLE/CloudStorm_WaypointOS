import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { readClockSetting, resolveClock } from "@/lib/server/clock";
import { runDepartureAlerts } from "@/lib/server/departures";
import { simulateOtherTrucks } from "@/lib/server/simulate";
import { triggerRelay } from "@/lib/server/relay-runner";

/**
 * Called every minute by the Convex cron (convex/crons.ts). Authenticated with the shared server
 * secret the Convex relay already uses, so only our Convex deployment can trigger it.
 */
export async function POST(req: Request) {
  const secret = process.env.CONVEX_SERVER_SECRET;
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const given = Buffer.from((req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(secret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return NextResponse.json({ error: "forbidden" }, { status: 401 });
  // a running demo clock moves on by itself: bring the simulated fleet along before checking departures
  if (resolveClock(await readClockSetting()).running) await simulateOtherTrucks();
  const result = await runDepartureAlerts();
  if (result.updated) await triggerRelay().catch(() => undefined); // push the new notices to open screens now
  return NextResponse.json(result);
}
