import "server-only";
import { and, eq, inArray, like, notInArray, sql } from "@waypoint/db/orm";
import { hhmm } from "@/lib/format";
import { resolveClock, readClockSetting, type BusinessNow } from "./clock";
import { db, t } from "./db";
import { notify } from "./events";
import { publishedPlan } from "./planning";
import { runs } from "./runs";

/**
 * Departure watch. A vehicle must leave at its planned time, so from LEAD_MIN minutes before
 * departure until the loader signs it off, the loader and the dispatcher are alerted: once when it
 * is due, then every minute it is late. The banner reads this list live; a Convex cron
 * (convex/crons.ts → /api/cron/departures) turns it into notifications every minute, and moving
 * the demo clock runs it too.
 */
export const LEAD_MIN = 5;
export const DEPOTS = ["Peliyagoda", "Kandy"] as const;
export type Depot = (typeof DEPOTS)[number];

export interface DepartureAlert {
  tripId: string;
  code: string;
  vehicleId: string;
  district: string;
  depot: Depot;
  departureMin: number;
  /** minutes until the planned departure; negative once it is late */
  minutesTo: number;
  state: "due" | "late";
  held: boolean;
  stops: number;
  loaded: number;
  shortfalls: number;
}

const dayDiff = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Trips of the running plan that are due within LEAD_MIN minutes, or late, and not signed off. */
export async function departureAlerts(depots: readonly Depot[], clock?: BusinessNow): Promise<{ clock: BusinessNow; alerts: DepartureAlert[] }> {
  const c = clock ?? resolveClock(await readClockSetting());
  const { active, planning } = await runs(c);
  const alerts: DepartureAlert[] = [];
  for (const depot of depots) {
    let plan = null;
    for (const d of [active, planning]) {
      plan = await publishedPlan(depot, d);
      if (plan) break;
    }
    if (!plan) continue;
    // business "now" in the plan's day, so a trip just after midnight is due the evening before
    const nowMin = c.minute + dayDiff(plan.runDate, c.date) * 1440;
    const rows = await db()
      .select({
        id: t.trips.id,
        code: t.trips.code,
        vehicleId: t.trips.vehicleId,
        district: t.trips.district,
        departureMin: t.trips.departureMin,
        status: t.trips.status,
        // fully qualified: inside a subquery a bare "id" would bind to the inner table
        stops: sql<number>`(select count(*)::int from trip_stops ts where ts.trip_id = "trips"."id")`,
        loaded: sql<number>`(select count(*)::int from load_checks lc where lc.trip_id = "trips"."id")`,
        shortfalls: sql<number>`(select count(*)::int from shortfalls sf where sf.trip_id = "trips"."id" and sf.status = 'open')`,
      })
      .from(t.trips)
      .where(
        and(
          eq(t.trips.planId, plan.id),
          notInArray(t.trips.status, ["en_route", "completed"]),
          sql`${t.trips.departureMin} is not null`,
          sql`not exists (select 1 from dock_signoffs ds where ds.trip_id = "trips"."id")`,
          sql`${t.trips.departureMin} - ${nowMin} <= ${LEAD_MIN}`,
        ),
      );
    for (const r of rows) {
      const minutesTo = Math.round(r.departureMin! - nowMin);
      alerts.push({
        tripId: r.id,
        code: r.code,
        vehicleId: r.vehicleId,
        district: r.district,
        depot,
        departureMin: r.departureMin!,
        minutesTo,
        state: minutesTo >= 0 ? "due" : "late",
        held: r.status === "held",
        stops: r.stops,
        loaded: r.loaded,
        shortfalls: r.shortfalls,
      });
    }
  }
  // most urgent first: the latest late trip, then the soonest due
  alerts.sort((a, b) => a.minutesTo - b.minutesTo || a.vehicleId.localeCompare(b.vehicleId));
  return { clock: c, alerts };
}

export const alertTitle = (a: DepartureAlert) =>
  a.state === "due"
    ? `${a.vehicleId} leaves ${a.minutesTo === 0 ? "now" : `in ${a.minutesTo} min`} - not signed off`
    : `${a.vehicleId} is ${-a.minutesTo} min late - not signed off`;

const alertBody = (a: DepartureAlert) =>
  `${a.code} to ${a.district} was planned to leave at ${hhmm(a.departureMin)}. ${a.loaded} of ${a.stops} orders loaded` +
  (a.shortfalls ? `, ${a.shortfalls} shortfall${a.shortfalls === 1 ? "" : "s"} waiting for the dispatcher` : "") +
  (a.held ? ". The dispatcher is holding it for a shortfall." : ". Sign it off so the driver can leave.");

/** Links double as the per-trip key of the departure notices. */
const links = (tripId: string) => ({ loader: `/dock/${tripId}`, dispatcher: `/dispatch/live?trip=${tripId}` });

/**
 * Writes the departure notices for the bell: one "due" notice per trip, and one "late" notice per
 * trip that is replaced (and marked unread) each minute it stays late, so the bell shows the
 * current lateness without filling up. Runs from the Convex cron and when the demo clock moves.
 */
export async function runDepartureAlerts() {
  const { alerts } = await departureAlerts(DEPOTS);
  let created = 0;
  for (const a of alerts) {
    const l = links(a.tripId);
    const type = a.state === "due" ? "departure.due" : "departure.late";
    const title = alertTitle(a);
    const existing = await db()
      .select({ id: t.notifications.id, title: t.notifications.title, link: t.notifications.link })
      .from(t.notifications)
      .where(and(eq(t.notifications.type, type), inArray(t.notifications.link, [l.loader, l.dispatcher])));
    // due: once per trip. late: again whenever the minutes late change (a paused demo clock stays quiet)
    if (a.state === "due" ? existing.length > 0 : existing.length > 0 && existing.every((e) => e.title === title)) continue;
    await db().transaction(async (tx) => {
      if (existing.length) await tx.delete(t.notifications).where(inArray(t.notifications.id, existing.map((e) => e.id)));
      const base = { type, title, body: alertBody(a), severity: a.state === "late" ? ("exception" as const) : ("late-risk" as const), depotId: a.depot };
      await notify(tx, { ...base, recipientRole: "loader", link: l.loader });
      await notify(tx, { ...base, recipientRole: "dispatcher", link: l.dispatcher });
    });
    created++;
  }
  return { alerts: alerts.length, updated: created };
}

/** After a sign-off the trip's departure notices are settled: mark them read so the bell clears. */
export async function settleDepartureNotices(tripId: string, at: Date) {
  const l = links(tripId);
  await db()
    .update(t.notifications)
    .set({ readAt: at })
    .where(and(like(t.notifications.type, "departure.%"), inArray(t.notifications.link, [l.loader, l.dispatcher]), sql`${t.notifications.readAt} is null`));
}
