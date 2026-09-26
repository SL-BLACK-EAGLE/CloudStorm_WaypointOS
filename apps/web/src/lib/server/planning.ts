import "server-only";
import { and, asc, desc, eq, inArray, ne } from "@waypoint/db/orm";
import type { Executor } from "@waypoint/db";
import {
  checkVehicleDay,
  contextForDate,
  makeOrder,
  nextOperatingDay,
  planDay,
  timePlan,
  weight,
  type DayContext,
  type Mode,
  type Order,
  type Plan,
  type Reference,
  type Trips,
} from "@waypoint/planner";
import { explainDeferral, type DeferralKind } from "@/lib/explain";
import { db, t } from "./db";
import { audit, emit } from "./events";
import { reference } from "./reference";

export type DepotId = "Peliyagoda" | "Kandy";
/** Orders still waiting for a run (the planner's input). */
const OPEN_STATUSES = ["confirmed", "planned", "deferred"] as const;

// ─────────────────────────────────────────────────────────────── inputs
export interface PlanningInput {
  R: Reference;
  orders: Order[];
  status: Record<string, string>;
  ctx: DayContext;
  fuelUsed: Record<string, number>;
  week: { isoYear: number; isoWeek: number };
}

export async function loadPlanningInput(depot: DepotId, runDate: string, x: Executor = db()): Promise<PlanningInput> {
  const R = await reference();
  const cal = R.calendar.get(runDate);
  if (!cal) throw new Error(`No calendar row for ${runDate}`);
  const [orderRows, dayRows, roadRows, fuelRows] = await Promise.all([
    x
      .select()
      .from(t.orders)
      .where(and(eq(t.orders.depotId, depot), eq(t.orders.runDate, runDate), inArray(t.orders.status, [...OPEN_STATUSES])))
      .orderBy(asc(t.orders.id)),
    x.select().from(t.vehicleDays).where(eq(t.vehicleDays.date, runDate)),
    x.select().from(t.roadConditions).where(eq(t.roadConditions.date, runDate)),
    x
      .select()
      .from(t.fuelLedger)
      .where(and(eq(t.fuelLedger.isoYear, cal.isoYear), eq(t.fuelLedger.isoWeek, cal.isoWeek))),
  ]);
  const byDay = new Map(dayRows.map((d) => [d.vehicleId, d.status]));
  const status: Record<string, string> = {};
  for (const v of R.vehicles.values()) if (v.depot === depot) status[v.id] = byDay.get(v.id) ?? "available";
  const orders = orderRows.map((o) =>
    makeOrder(R, {
      ref: o.id,
      outletId: o.outletId,
      temp: o.temp,
      units: o.units,
      kg: o.weightKg,
      m3: o.volumeM3,
      deferredYesterday: o.deferredYesterday,
      daysSinceLastServed: o.daysSinceLastServed,
    }),
  );
  const ctx = contextForDate(R, runDate, Object.fromEntries(roadRows.map((r) => [r.district, r.disruptionIndex])));
  const fuelUsed = Object.fromEntries(fuelRows.map((f) => [f.vehicleId, f.litresUsed]));
  return { R, orders, status, ctx, fuelUsed, week: { isoYear: cal.isoYear, isoWeek: cal.isoWeek } };
}

// ─────────────────────────────────────────────────────────────── persistence
function tripCode(runDate: string, vehicleId: string, n: number) {
  return `R${runDate.slice(8, 10)}${vehicleId.slice(3)}${n}`; // e.g. R230021 = 23rd, VEH002, trip 1
}

async function writeTrips(tx: Executor, planId: string, runDate: string, plan: Pick<Plan, "timed">) {
  for (const tt of plan.timed) {
    const first = tt.stops[0]!;
    const [trip] = await tx
      .insert(t.trips)
      .values({
        planId,
        code: tripCode(runDate, tt.vehicleId, tt.number),
        vehicleId: tt.vehicleId,
        tripNo: tt.number,
        brand: first.outlet.brand,
        district: first.outlet.district,
        departureMin: tt.departure,
        backMin: tt.backPlanned,
        tripMinutes: tt.tripMinutes,
        litres: tt.litres,
      })
      .returning({ id: t.trips.id });
    await tx.insert(t.tripStops).values(
      tt.stops.map((o, k) => ({
        tripId: trip!.id,
        orderId: o.ref,
        seq: k + 1,
        plannedArrive: tt.planned[k]?.arrive ?? null,
        plannedStart: tt.planned[k]?.start ?? null,
        plannedLeave: tt.planned[k]?.leave ?? null,
        expectedArrive: tt.expected[k]?.arrive ?? null,
        expectedLeave: tt.expected[k]?.leave ?? null,
        lateRisk: !!(tt.expected[k]?.late || tt.expected[k]?.risk),
        plannedLate: !!tt.planned[k]?.late,
        etaMin: tt.expected[k]?.arrive ?? null,
      })),
    );
  }
}

async function writeDeferrals(tx: Executor, planId: string, input: PlanningInput, plan: Plan, runDate: string) {
  const byRef = new Map(input.orders.map((o) => [o.ref, o]));
  const newRun = nextOperatingDay(input.R, runDate);
  const rows = [...plan.deferrals.values()].map((d) => {
    const o = byRef.get(d.ref)!;
    const lost = d.lostTo ? byRef.get(d.lostTo) : undefined;
    return {
      planId,
      orderId: d.ref,
      kind: d.kind as DeferralKind,
      reasonCode: d.kind === "CHOSEN" ? "LOST_TO_HIGHER_PRIORITY" : d.reason,
      lostToOrderId: d.lostTo,
      explanation: explainDeferral({
        kind: d.kind,
        reasonCode: d.reason,
        lostTo: lost
          ? {
              orderId: lost.ref,
              outletId: lost.outletId,
              deferredYesterday: lost.deferredYesterday,
              daysSinceLastServed: lost.daysSinceLastServed,
              chilled: lost.temp === "chilled",
            }
          : null,
      }),
      fairness: { deferredYesterday: o.deferredYesterday, daysSinceLastServed: o.daysSinceLastServed, weight: weight(o) },
      newRunDate: newRun,
    };
  });
  if (rows.length) await tx.insert(t.deferrals).values(rows);
}

export function planMetrics(input: PlanningInput, plan: Pick<Plan, "timed" | "deferrals">) {
  const served = plan.timed.reduce((n, tt) => n + tt.stops.length, 0);
  const chilled = input.orders.filter((o) => o.temp === "chilled");
  const servedRefs = new Set(plan.timed.flatMap((tt) => tt.stops.map((o) => o.ref)));
  const kinds: Record<string, number> = {};
  for (const d of plan.deferrals.values()) kinds[d.kind] = (kinds[d.kind] ?? 0) + 1;
  return {
    orders: input.orders.length,
    served,
    deferred: plan.deferrals.size,
    chilled: chilled.length,
    chilledServed: chilled.filter((o) => servedRefs.has(o.ref)).length,
    trips: plan.timed.length,
    vehicles: new Set(plan.timed.map((tt) => tt.vehicleId)).size,
    litres: plan.timed.reduce((s, tt) => s + tt.litres, 0),
    lateRiskStops: plan.timed.reduce((n, tt) => n + tt.expected.filter((l) => l.late || l.risk).length, 0),
    kinds,
  };
}

/** Runs the planner and stores the result as a new draft version (earlier drafts are superseded). */
export async function runAutoPlan(opts: { depot: DepotId; runDate: string; userId: string; mode?: Mode }) {
  const t0 = performance.now();
  const input = await loadPlanningInput(opts.depot, opts.runDate);
  const plan = planDay(input.R, input.orders, input.status, input.ctx, opts.mode ?? "LIVE", input.fuelUsed);
  const ms = Math.round(performance.now() - t0);
  const metrics = { ...planMetrics(input, plan), runtimeMs: ms };

  const planId = await db().transaction(async (tx) => {
    const [last] = await tx
      .select({ version: t.plans.version })
      .from(t.plans)
      .where(and(eq(t.plans.depotId, opts.depot), eq(t.plans.runDate, opts.runDate)))
      .orderBy(desc(t.plans.version))
      .limit(1);
    await tx
      .update(t.plans)
      .set({ status: "superseded" })
      .where(and(eq(t.plans.depotId, opts.depot), eq(t.plans.runDate, opts.runDate), eq(t.plans.status, "draft")));
    const [row] = await tx
      .insert(t.plans)
      .values({
        depotId: opts.depot,
        runDate: opts.runDate,
        version: (last?.version ?? 0) + 1,
        status: "draft",
        mode: opts.mode ?? "LIVE",
        metrics,
        createdBy: opts.userId,
      })
      .returning({ id: t.plans.id });
    await writeTrips(tx, row!.id, opts.runDate, plan);
    await writeDeferrals(tx, row!.id, input, plan, opts.runDate);
    await audit(tx, { actorId: opts.userId, action: "plan.auto", entity: "plan", entityId: row!.id, after: metrics });
    await emit(tx, "plan.drafted", { planId: row!.id, depot: opts.depot, runDate: opts.runDate, metrics });
    return row!.id;
  });
  return { planId, metrics };
}

// ─────────────────────────────────────────────────────────────── reading a plan
export async function currentPlan(depot: DepotId, runDate: string) {
  const [p] = await db()
    .select()
    .from(t.plans)
    .where(and(eq(t.plans.depotId, depot), eq(t.plans.runDate, runDate), ne(t.plans.status, "superseded")))
    .orderBy(desc(t.plans.version))
    .limit(1);
  return p ?? null;
}

export async function publishedPlan(depot: DepotId, runDate: string) {
  const [p] = await db()
    .select()
    .from(t.plans)
    .where(and(eq(t.plans.depotId, depot), eq(t.plans.runDate, runDate), eq(t.plans.status, "published")))
    .orderBy(desc(t.plans.version))
    .limit(1);
  return p ?? null;
}

/** Rebuilds the planner's Trips map for a stored plan (for validation and re-timing after edits). */
export async function tripsOf(planId: string, input: PlanningInput): Promise<Trips> {
  const rows = await db()
    .select({ vehicleId: t.trips.vehicleId, tripNo: t.trips.tripNo, orderId: t.tripStops.orderId, seq: t.tripStops.seq })
    .from(t.trips)
    .innerJoin(t.tripStops, eq(t.tripStops.tripId, t.trips.id))
    .where(eq(t.trips.planId, planId))
    .orderBy(asc(t.trips.vehicleId), asc(t.trips.tripNo), asc(t.tripStops.seq));
  const byRef = new Map(input.orders.map((o) => [o.ref, o]));
  const trips: Trips = new Map();
  for (const r of rows) {
    const o = byRef.get(r.orderId);
    if (!o) continue;
    const list = trips.get(r.vehicleId) ?? [];
    while (list.length < r.tripNo) list.push([]);
    list[r.tripNo - 1]!.push(o);
    trips.set(r.vehicleId, list);
  }
  for (const [v, ts] of trips) trips.set(v, ts.filter((x) => x.length > 0));
  return trips;
}

/** Validates a vehicle's proposed day with the same F5 rules the planner uses (LIVE mode). */
export function validateDay(input: PlanningInput, vehicleId: string, day: Order[][]) {
  if (input.status[vehicleId] !== "available") return { ok: false, code: "IN_WORKSHOP" };
  const chk = checkVehicleDay(input.R, vehicleId, day, input.ctx, "LIVE", input.fuelUsed[vehicleId] ?? 0);
  return { ok: chk.ok, code: chk.code };
}

/** Re-times and rewrites the given vehicles' trips in a plan after a manual edit. */
export async function rewriteVehicles(tx: Executor, planId: string, runDate: string, input: PlanningInput, trips: Trips, vehicleIds: string[]) {
  const affected = new Map([...trips].filter(([v]) => vehicleIds.includes(v) && trips.get(v)!.length > 0));
  const old = await tx
    .select({ id: t.trips.id })
    .from(t.trips)
    .where(and(eq(t.trips.planId, planId), inArray(t.trips.vehicleId, vehicleIds)));
  if (old.length) await tx.delete(t.trips).where(inArray(t.trips.id, old.map((o) => o.id)));
  const timed = timePlan(input.R, affected, input.ctx, "LIVE", input.fuelUsed);
  await writeTrips(tx, planId, runDate, { timed });
}

export { OPEN_STATUSES };
