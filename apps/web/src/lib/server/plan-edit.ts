import "server-only";
import { and, eq, inArray } from "@waypoint/db/orm";
import type { Executor } from "@waypoint/db";
import { nextOperatingDay, OVERRIDABLE_CODES, RULE_TEXT, timePlan, weight, type Order, type Trips } from "@waypoint/planner";
import { businessDate, now } from "./clock";
import { explainDeferral } from "@/lib/explain";
import { db, t } from "./db";
import { audit, emit, notify } from "./events";
import { loadPlanningInput, tripsOf, validateDay, type DepotId, type PlanningInput } from "./planning";

export type MoveTarget = { kind: "trip"; vehicleId: string; tripNo: number | "new" } | { kind: "defer"; justification: string };
export type MoveResult = { ok: true; message: string } | { ok: false; error: string; code?: string; overridable?: boolean };

/** A timing or fuel rule the dispatcher overrode for one vehicle of a plan, with the reason (kept in plans.metrics). */
export interface PlanOverride {
  vehicleId: string;
  code: string;
  orderId: string;
  justification: string;
  by: string;
  at: string;
}

export function overridesOf(metrics: unknown): PlanOverride[] {
  const o = (metrics as { overrides?: PlanOverride[] } | null)?.overrides;
  return Array.isArray(o) ? o : [];
}

/** Vehicles whose day carries an accepted override (their day is timed even though a timing/fuel rule fails). */
export const overriddenVehicles = (metrics: unknown) => new Set(overridesOf(metrics).map((o) => o.vehicleId));

const LOCKED_TRIP = ["en_route", "completed"] as const;

function tripCode(runDate: string, vehicleId: string, n: number) {
  return `R${runDate.slice(8, 10)}${vehicleId.slice(3)}${n}`; // e.g. R230021 = 23rd, VEH002, trip 1
}

/**
 * Re-times the affected vehicles and writes the result *in place*: trip and stop rows keep
 * their ids (loader checks, driver events and PoDs reference them), and every stop whose
 * trip or position changed gets a new version - which is how an offline driver's device
 * later detects that the plan moved under it (flowchart F9 Q4-Q6).
 */
export async function rewriteInPlace(
  tx: Executor,
  planId: string,
  runDate: string,
  input: PlanningInput,
  trips: Trips,
  vehicleIds: string[],
  overridden: ReadonlySet<string> = new Set(),
) {
  const affected: Trips = new Map([...trips].filter(([v, ts]) => vehicleIds.includes(v) && ts.length > 0));
  const timed = timePlan(input.R, affected, input.ctx, "LIVE", input.fuelUsed, overridden);

  const oldTrips = await tx.select().from(t.trips).where(and(eq(t.trips.planId, planId), inArray(t.trips.vehicleId, vehicleIds)));
  const oldStops = oldTrips.length
    ? await tx.select().from(t.tripStops).where(inArray(t.tripStops.tripId, oldTrips.map((x) => x.id)))
    : [];
  const tripByKey = new Map(oldTrips.map((x) => [`${x.vehicleId}|${x.tripNo}`, x]));
  const stopByOrder = new Map(oldStops.map((s) => [s.orderId, s]));
  const keptTrips = new Set<string>();
  const keptStops = new Set<string>();

  for (const tt of timed) {
    const first = tt.stops[0]!;
    const values = {
      code: tripCode(runDate, tt.vehicleId, tt.number),
      brand: first.outlet.brand,
      district: first.outlet.district,
      departureMin: tt.departure,
      backMin: tt.backPlanned,
      tripMinutes: tt.tripMinutes,
      litres: tt.litres,
    };
    const existing = tripByKey.get(`${tt.vehicleId}|${tt.number}`);
    let tripId: string;
    if (existing) {
      await tx.update(t.trips).set(values).where(eq(t.trips.id, existing.id));
      tripId = existing.id;
    } else {
      const [row] = await tx.insert(t.trips).values({ planId, vehicleId: tt.vehicleId, tripNo: tt.number, ...values }).returning({ id: t.trips.id });
      tripId = row!.id;
    }
    keptTrips.add(tripId);
    for (let k = 0; k < tt.stops.length; k++) {
      const o = tt.stops[k]!;
      const p = tt.planned[k];
      const e = tt.expected[k];
      const times = {
        tripId,
        seq: k + 1,
        plannedArrive: p?.arrive ?? null,
        plannedStart: p?.start ?? null,
        plannedLeave: p?.leave ?? null,
        expectedArrive: e?.arrive ?? null,
        expectedLeave: e?.leave ?? null,
        lateRisk: !!(e?.late || e?.risk),
        plannedLate: !!p?.late,
        etaMin: e?.arrive ?? null,
      };
      const s = stopByOrder.get(o.ref);
      if (s) {
        const moved = s.tripId !== tripId || s.seq !== k + 1;
        await tx.update(t.tripStops).set({ ...times, version: moved ? s.version + 1 : s.version }).where(eq(t.tripStops.id, s.id));
        keptStops.add(s.id);
      } else {
        const [row] = await tx.insert(t.tripStops).values({ ...times, orderId: o.ref }).returning({ id: t.tripStops.id });
        keptStops.add(row!.id);
      }
    }
  }
  const dropStops = oldStops.filter((s) => !keptStops.has(s.id)).map((s) => s.id);
  if (dropStops.length) await tx.delete(t.tripStops).where(inArray(t.tripStops.id, dropStops));
  const dropTrips = oldTrips.filter((x) => !keptTrips.has(x.id)).map((x) => x.id);
  if (dropTrips.length) await tx.delete(t.trips).where(inArray(t.trips.id, dropTrips));
}

async function refreshMetrics(tx: Executor, planId: string) {
  const [p] = await tx.select().from(t.plans).where(eq(t.plans.id, planId));
  const trips = await tx.select({ id: t.trips.id, vehicleId: t.trips.vehicleId, litres: t.trips.litres }).from(t.trips).where(eq(t.trips.planId, planId));
  const stops = trips.length ? await tx.select({ id: t.tripStops.id }).from(t.tripStops).where(inArray(t.tripStops.tripId, trips.map((x) => x.id))) : [];
  const defs = await tx.select({ kind: t.deferrals.kind }).from(t.deferrals).where(eq(t.deferrals.planId, planId));
  const kinds: Record<string, number> = {};
  for (const d of defs) kinds[d.kind] = (kinds[d.kind] ?? 0) + 1;
  const metrics = {
    ...(p?.metrics ?? {}),
    served: stops.length,
    deferred: defs.length,
    trips: trips.length,
    vehicles: new Set(trips.map((x) => x.vehicleId)).size,
    litres: trips.reduce((s, x) => s + x.litres, 0),
    kinds,
    edited: true,
  };
  await tx.update(t.plans).set({ metrics }).where(eq(t.plans.id, planId));
}

/** Moves one order between trips, onto a new trip, off the deferral list, or into it (manual deferral). */
export async function moveOrder(opts: { planId: string; orderId: string; to: MoveTarget; userId: string; override?: string }): Promise<MoveResult> {
  const [plan] = await db().select().from(t.plans).where(eq(t.plans.id, opts.planId));
  if (!plan || plan.status === "superseded") return { ok: false, error: "This plan version is no longer current. Reload the board." };
  const depot = plan.depotId as DepotId;
  const input = await loadPlanningInput(depot, plan.runDate, db(), { planId: plan.id });
  const order = input.orders.find((o) => o.ref === opts.orderId);
  if (!order) return { ok: false, error: `${opts.orderId} is not in this run's queue.` };

  const trips = await tripsOf(plan.id, input);
  let fromVehicle: string | null = null;
  for (const [v, ts] of trips) if (ts.some((tr) => tr.includes(order))) fromVehicle = v;

  // stops already on the road cannot move
  if (fromVehicle) {
    const locked = await db()
      .select({ id: t.trips.id })
      .from(t.trips)
      .innerJoin(t.tripStops, eq(t.tripStops.tripId, t.trips.id))
      .where(and(eq(t.trips.planId, plan.id), eq(t.tripStops.orderId, order.ref), inArray(t.trips.status, [...LOCKED_TRIP])));
    if (locked.length) return { ok: false, error: "That trip has already left the depot. Change it from live operations instead." };
  }

  const next: Trips = new Map([...trips].map(([v, ts]) => [v, ts.map((tr) => tr.filter((o) => o !== order)).filter((tr) => tr.length > 0)]));
  const touched = new Set<string>(fromVehicle ? [fromVehicle] : []);
  const overridden = new Set(overriddenVehicles(plan.metrics));
  let newOverride: PlanOverride | null = null;

  if (opts.to.kind === "trip") {
    const { vehicleId, tripNo } = opts.to;
    const day = next.get(vehicleId) ?? [];
    let proposed: Order[][];
    if (tripNo === "new") proposed = [...day, [order]];
    else {
      const idx = tripNo - 1;
      // numbering refers to the board before the move
      const before = trips.get(vehicleId) ?? [];
      const targetTrip = before[idx];
      if (!targetTrip) return { ok: false, error: `${vehicleId} has no trip ${tripNo}.` };
      proposed = day.map((tr) => (tr.some((o) => targetTrip.includes(o)) ? [...tr, order] : tr));
      if (!proposed.some((tr) => tr.includes(order))) proposed = [...day, [order]];
    }
    const chk = validateDay(input, vehicleId, proposed);
    if (!chk.ok) {
      const overridable = OVERRIDABLE_CODES.has(chk.code ?? "");
      const why = opts.override?.trim() ?? "";
      if (!overridable || why.length < 10) {
        return {
          ok: false,
          code: chk.code ?? undefined,
          overridable,
          error: chk.code === "IN_WORKSHOP" ? `${vehicleId} is in the workshop.` : (RULE_TEXT[chk.code ?? ""] ?? `Breaks rule ${chk.code}`),
        };
      }
      // the dispatcher accepts a timing/fuel overrun knowingly, with a reason
      newOverride = { vehicleId, code: chk.code!, orderId: order.ref, justification: why, by: opts.userId, at: businessDate(await now()).toISOString() };
      overridden.add(vehicleId);
    }
    next.set(vehicleId, proposed);
    touched.add(vehicleId);
  }
  if (fromVehicle && (next.get(fromVehicle)?.length ?? 0) > 0) {
    const chk = validateDay(input, fromVehicle, next.get(fromVehicle)!);
    if (!chk.ok && !(overridden.has(fromVehicle) && OVERRIDABLE_CODES.has(chk.code ?? ""))) {
      return { ok: false, error: `Removing it would leave ${fromVehicle} invalid (${chk.code}).` };
    }
  }

  const published = plan.status === "published";
  const newRun = nextOperatingDay(input.R, plan.runDate);
  await db().transaction(async (tx) => {
    await rewriteInPlace(tx, plan.id, plan.runDate, input, next, [...touched], overridden);
    if (newOverride) {
      const [p] = await tx.select({ metrics: t.plans.metrics }).from(t.plans).where(eq(t.plans.id, plan.id));
      const metrics = { ...((p?.metrics as Record<string, unknown>) ?? {}), overrides: [...overridesOf(p?.metrics), newOverride] };
      await tx.update(t.plans).set({ metrics }).where(eq(t.plans.id, plan.id));
      await audit(tx, {
        actorId: opts.userId,
        action: "plan.override",
        entity: "vehicle",
        entityId: newOverride.vehicleId,
        after: { planId: plan.id, code: newOverride.code, orderId: order.ref },
        justification: newOverride.justification,
      });
    }
    const [existingDeferral] = await tx.select().from(t.deferrals).where(and(eq(t.deferrals.planId, plan.id), eq(t.deferrals.orderId, order.ref)));
    if (opts.to.kind === "trip" && existingDeferral) {
      await tx.delete(t.deferrals).where(eq(t.deferrals.id, existingDeferral.id));
      if (published) await tx.update(t.orders).set({ status: "planned", runDate: plan.runDate, updatedAt: new Date() }).where(eq(t.orders.id, order.ref));
    }
    if (opts.to.kind === "defer") {
      const justification = opts.to.justification;
      if (!existingDeferral) {
        await tx.insert(t.deferrals).values({
          planId: plan.id,
          orderId: order.ref,
          kind: "MANUAL",
          reasonCode: "DISPATCHER_DECISION",
          explanation: explainDeferral({ kind: "MANUAL", reasonCode: "DISPATCHER_DECISION", justification }),
          fairness: { deferredYesterday: order.deferredYesterday, daysSinceLastServed: order.daysSinceLastServed, weight: weight(order) },
          newRunDate: newRun,
          decidedBy: opts.userId,
          decidedAt: new Date(),
        });
      }
      if (published) {
        await tx.update(t.orders).set({ status: "deferred", updatedAt: new Date() }).where(eq(t.orders.id, order.ref));
        await notify(tx, {
          type: "order.deferred",
          title: `Order ${order.ref} moved to the next run`,
          body: `The dispatcher moved it: ${justification}`,
          link: `/store/orders/${order.ref}`,
          severity: "late-risk",
          outletId: order.outletId,
        });
      }
    }
    await refreshMetrics(tx, plan.id);
    await audit(tx, {
      actorId: opts.userId,
      action: opts.to.kind === "defer" ? "plan.defer" : existingDeferral ? "plan.serve_override" : "plan.move",
      entity: "order",
      entityId: order.ref,
      before: { vehicle: fromVehicle, deferred: !!existingDeferral },
      after: opts.to,
      justification: opts.to.kind === "defer" ? opts.to.justification : undefined,
    });
    await emit(tx, "plan.edited", { planId: plan.id, orderId: order.ref, vehicles: [...touched], published });
  });

  const where = opts.to.kind === "trip" ? `${opts.to.vehicleId}${opts.to.tripNo === "new" ? " (new trip)" : ` trip ${opts.to.tripNo}`}` : "the deferral list";
  return {
    ok: true,
    message: newOverride
      ? `${order.ref} (${order.outletId}) moved to ${where}. Override recorded: ${RULE_TEXT[newOverride.code] ?? newOverride.code}.`
      : `${order.ref} (${order.outletId}) moved to ${where}. Every rule still passes.`,
  };
}
