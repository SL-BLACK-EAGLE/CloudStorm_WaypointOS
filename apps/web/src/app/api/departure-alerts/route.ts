import { NextResponse } from "next/server";
import { currentDepot } from "@/app/dispatch/depot";
import { DEPOTS, departureAlerts, type Depot } from "@/lib/server/departures";
import { userForApi } from "@/lib/server/session";

/** The departure banner's data: trips due within 5 minutes or late, not signed off, for the caller's depot. */
export async function GET() {
  const user = await userForApi(["dispatcher", "loader"]);
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const depots: readonly Depot[] =
    user.role === "dispatcher" ? [await currentDepot()] : DEPOTS.includes(user.depotId as Depot) ? [user.depotId as Depot] : DEPOTS;
  const { clock, alerts } = await departureAlerts(depots);
  return NextResponse.json({ clock: { date: clock.date, minute: clock.minute }, alerts }, { headers: { "cache-control": "no-store" } });
}
