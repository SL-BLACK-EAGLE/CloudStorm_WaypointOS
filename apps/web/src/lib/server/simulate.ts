import "server-only";
import type { Executor } from "@waypoint/db";
import { and, asc, eq, inArray } from "@waypoint/db/orm";
import { db, t } from "./db";
import { refreshEtas } from "./drive";
import { readClockSetting, resolveClock } from "./clock";
import { publishedPlan, type DepotId } from "./planning";
import { runs } from "./runs";

/**
 * Demo fleet simulator. Only the demo driver's phone records real events, so for the live screens
 * every other truck is advanced along its planned times up to the business clock, with deterministic
 * drift (road disruption for the district plus a per-trip/per-stop jitter). It only ever moves trips
 * forward, never touches the demo driver's vehicle, and leaves a truck at the dock while it has an
 * undecided shortfall - that is the D-06 "hasn't left" case. One truck per depot is held at a stop
 * that began 20-50 minutes ago (the D-06 "long stop" case) whenever the clock lands mid-run.
 */
export async function simulateFleet(opts: { skipVehicleIds: string[] }) {
  // read the clock fresh: the demo panel moves it earlier in the same request, and now() is memoised per request
  const clock = resolveClock(await readClockSetting());
  const { active, planning } = await runs(clock);
  const touched = new Set<string>();
  let delivered = 0;
  let departed = 0;
  for (const depot of ["Peliyagoda", "Kandy"] as DepotId[]) {
    const plan = (await publishedPlan(depot, active)) ?? (await publishedPlan(depot, planning));
    if (!plan || plan.runDate !== clock.date) continue;
    const nowMin = clock.minute;
    const trips = (await db().select().from(t.trips).where(eq(t.trips.planId, plan.id)).orderBy(asc(t.trips.code))).filter(
      (tr) => !opts.skipVehicleIds.includes(tr.vehicleId) && tr.status !== "completed",
    );
    if (!trips.length) continue;
    const tripIds = trips.map((x) => x.id);
    const [stops, signs, shorts, roads] = await Promise.all([
      db()
        .select({ s: t.tripStops, units: t.orders.units })
        .from(t.tripStops)
        .innerJoin(t.orders, eq(t.orders.id, t.tripStops.orderId))
        .where(inArray(t.tripStops.tripId, tripIds))
        .orderBy(asc(t.tripStops.seq)),
      db().select().from(t.dockSignoffs).where(inArray(t.dockSignoffs.tripId, tripIds)),
      db()
        .select()
        .from(t.shortfalls)
        .where(and(inArray(t.shortfalls.tripId, tripIds), eq(t.shortfalls.status, "open"))),
      db().select().from(t.roadConditions).where(eq(t.roadConditions.date, plan.runDate)),
    ]);
    const disruption = new Map(roads.map((r) => [r.district, r.disruptionIndex]));
    let longStopUsed = false;

    for (const tr of trips) {
      if (tr.departureMin === null) continue;
      const blocked = shorts.some((s) => s.tripId === tr.id && s.decision !== "SEND_AND_WARN") || tr.status === "held";
      const signed = signs.some((s) => s.tripId === tr.id);
      if (blocked) continue; // stays at the dock until the dispatcher decides
      // a person is loading it: they sign it off, and it only leaves once they have
      if (!signed && tr.status === "loading") continue;
      // simulated loaders sign off 15 minutes before departure, so the departure watch flags real delays only
      if (!signed && tr.status === "planned" && nowMin >= tr.departureMin - 15) {
        await db().transaction(async (tx) => {
          await tx.insert(t.dockSignoffs).values({ tripId: tr.id, state: "RELEASED" }).onConflictDoNothing();
          await tx.update(t.trips).set({ status: "ready" }).where(and(eq(t.trips.id, tr.id), eq(t.trips.status, "planned")));
        });
      }
      const d0 = jitter(tr.code, 0, 9);
      const leaveAt = tr.departedMin ?? tr.departureMin + d0;
      if (leaveAt > nowMin) continue;
      const ss = stops.filter((x) => x.s.tripId === tr.id);
      // disruption_index is a percentage (100 = normal roads; travel = planned x 100/index): extra minutes per leg
      const perStop = Math.max(0, 100 / (disruption.get(tr.district) ?? 100) - 1) * 10;
      let drift = leaveAt - tr.departureMin;
      let last = leaveAt;
      await db().transaction(async (tx) => {
        if (!signed) await tx.insert(t.dockSignoffs).values({ tripId: tr.id, state: "RELEASED" }).onConflictDoNothing();
        if (tr.departedMin === null) {
          await tx.update(t.trips).set({ status: "en_route", departedMin: leaveAt, lastSeenMin: leaveAt }).where(eq(t.trips.id, tr.id));
          await tx.update(t.orders).set({ status: "en_route" }).where(
            inArray(
              t.orders.id,
              ss.map((x) => x.s.orderId),
            ),
          );
          departed++;
        }
        for (const { s, units } of ss) {
          if (s.status === "delivered" || s.status === "exception" || s.status === "skipped") {
            if (s.leftMin !== null) last = s.leftMin;
            if (s.arrivedMin !== null && s.plannedArrive !== null) drift = s.arrivedMin - s.plannedArrive;
            continue;
          }
          if (s.plannedArrive === null) break;
          drift += perStop + jitter(`${tr.code}-${s.seq}`, -3, 6);
          const arrive = Math.max(last + 1, s.plannedArrive + Math.max(0, drift));
          const service = (s.plannedLeave ?? s.plannedArrive + 15) - s.plannedArrive;
          let leave = arrive + service;
          if (!longStopUsed && ss.length >= 3 && arrive >= nowMin - 50 && arrive <= nowMin - 20 && leave <= nowMin) {
            leave = nowMin + 10; // still there: the long stop
            longStopUsed = true;
          }
          if (arrive > nowMin) break;
          if (leave > nowMin) {
            if (s.status !== "arrived") await tx.update(t.tripStops).set({ status: "arrived", arrivedMin: Math.round(arrive) }).where(eq(t.tripStops.id, s.id));
            await tx.update(t.trips).set({ lastSeenMin: Math.round(arrive) }).where(eq(t.trips.id, tr.id));
            break;
          }
          await tx
            .insert(t.pods)
            .values({ stopId: s.id, recipientName: "Store staff", unitsHanded: units, arrivedMin: Math.round(arrive), completedMin: Math.round(leave), deviceId: "simulator" })
            .onConflictDoNothing();
          await tx
            .update(t.tripStops)
            .set({ status: "delivered", arrivedMin: Math.round(arrive), leftMin: Math.round(leave) })
            .where(eq(t.tripStops.id, s.id));
          await tx.update(t.orders).set({ status: "delivered" }).where(eq(t.orders.id, s.orderId));
          await tx.update(t.trips).set({ lastSeenMin: Math.round(leave) }).where(eq(t.trips.id, tr.id));
          last = leave;
          drift = arrive - s.plannedArrive;
          delivered++;
        }
        const back = tr.backMin !== null ? tr.backMin + Math.max(0, drift) : null;
        const allDone = ss.every((x) => x.s.status !== "planned" && x.s.status !== "arrived") || (await remainingCount(tx, tr.id)) === 0;
        if (allDone && back !== null && back <= nowMin) await tx.update(t.trips).set({ status: "completed", completedMin: Math.round(back) }).where(eq(t.trips.id, tr.id));
      });
      touched.add(tr.id);
    }
  }
  for (const id of touched) await refreshEtas(id).catch(() => undefined);
  return { trips: touched.size, departed, delivered };
}

async function remainingCount(tx: Executor, tripId: string) {
  const rows = await tx
    .select({ id: t.tripStops.id })
    .from(t.tripStops)
    .where(and(eq(t.tripStops.tripId, tripId), inArray(t.tripStops.status, ["planned", "arrived"])));
  return rows.length;
}

/** Deterministic integer in [lo, hi] from a string (same trip, same drift every time). */
function jitter(key: string, lo: number, hi: number) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return lo + ((h >>> 0) % (hi - lo + 1));
}

/** Every truck except those driven by a driver account follows its plan up to the business clock. */
export async function simulateOtherTrucks() {
  const drivers = await db().select({ vehicleId: t.users.vehicleId }).from(t.users).where(eq(t.users.role, "driver"));
  return simulateFleet({ skipVehicleIds: drivers.map((d) => d.vehicleId).filter((v): v is string => !!v) });
}
