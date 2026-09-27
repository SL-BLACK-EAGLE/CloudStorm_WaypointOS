import "server-only";
import { and, eq, inArray, ne } from "@waypoint/db/orm";
import { checkVehicleDay, weight } from "@waypoint/planner";
import { explainDeferral, explainForStore, type DeferralKind } from "@/lib/explain";
import { dayLabel, hhmm } from "@/lib/format";
import { businessDate, now } from "./clock";
import { db, t } from "./db";
import { audit, emit, notify } from "./events";
import { rewriteInPlace, type MoveResult } from "./plan-edit";
import { loadPlanningInput, tripsOf, type DepotId } from "./planning";

/** D-04 "Keep deferred": the dispatcher confirms a chosen deferral with a reason. */
export async function keepDeferred(opts: { planId: string; orderId: string; reason: string; userId: string }): Promise<MoveResult> {
  const [d] = await db()
    .select()
    .from(t.deferrals)
    .where(and(eq(t.deferrals.planId, opts.planId), eq(t.deferrals.orderId, opts.orderId)));
  if (!d) return { ok: false, error: "That order is not deferred in this plan." };
  await db().transaction(async (tx) => {
    await tx
      .update(t.deferrals)
      .set({ decidedBy: opts.userId, decidedAt: new Date(), explanation: `${d.explanation} Dispatcher: ${opts.reason}` })
      .where(eq(t.deferrals.id, d.id));
    await audit(tx, { actorId: opts.userId, action: "deferral.keep", entity: "order", entityId: opts.orderId, justification: opts.reason });
    await emit(tx, "plan.edited", { planId: opts.planId, orderId: opts.orderId });
  });
  return { ok: true, message: `${opts.orderId} stays deferred - reason recorded.` };
}

/**
 * D-04 "Serve instead": a chosen deferral lost its slot to a higher-weight order. The swap
 * puts it back on that trip and defers the other order instead - validated with rules 1-7,
 * windows and fuel before anything is written.
 */
export async function swapDeferral(opts: { planId: string; orderId: string; outOrderId: string; userId: string; reason: string }): Promise<MoveResult> {
  const [plan] = await db().select().from(t.plans).where(eq(t.plans.id, opts.planId));
  if (!plan || plan.status === "superseded") return { ok: false, error: "This plan version is no longer current." };
  const input = await loadPlanningInput(plan.depotId as DepotId, plan.runDate);
  const inO = input.orders.find((o) => o.ref === opts.orderId);
  const outO = input.orders.find((o) => o.ref === opts.outOrderId);
  if (!inO || !outO) return { ok: false, error: "Order not found in this run." };
  const trips = await tripsOf(plan.id, input);
  let vehicle: string | null = null;
  for (const [v, ts] of trips) {
    const i = ts.findIndex((tr) => tr.includes(outO));
    if (i >= 0) {
      vehicle = v;
      trips.set(v, ts.map((tr, j) => (j === i ? [...tr.filter((o) => o !== outO), inO] : tr)));
    }
  }
  if (!vehicle) return { ok: false, error: `${opts.outOrderId} is no longer on a trip.` };
  const chk = checkVehicleDay(input.R, vehicle, trips.get(vehicle)!, input.ctx, "LIVE", input.fuelUsed[vehicle] ?? 0);
  if (!chk.ok) return { ok: false, error: `The swap breaks ${chk.code} on ${vehicle}.` };

  await db().transaction(async (tx) => {
    await rewriteInPlace(tx, plan.id, plan.runDate, input, trips, [vehicle!]);
    await tx.delete(t.deferrals).where(and(eq(t.deferrals.planId, plan.id), eq(t.deferrals.orderId, inO.ref)));
    await tx.insert(t.deferrals).values({
      planId: plan.id,
      orderId: outO.ref,
      kind: "CHOSEN",
      reasonCode: "SWAPPED_BY_DISPATCHER",
      lostToOrderId: inO.ref,
      explanation: explainDeferral({ kind: "MANUAL", reasonCode: "SWAPPED_BY_DISPATCHER", justification: `swapped for ${inO.ref} (${inO.outletId}): ${opts.reason}` }),
      fairness: { deferredYesterday: outO.deferredYesterday, daysSinceLastServed: outO.daysSinceLastServed, weight: weight(outO) },
      newRunDate: (await tx.select({ d: t.deferrals.newRunDate }).from(t.deferrals).where(eq(t.deferrals.planId, plan.id)).limit(1))[0]?.d ?? null,
      decidedBy: opts.userId,
      decidedAt: new Date(),
    });
    await audit(tx, { actorId: opts.userId, action: "deferral.swap", entity: "order", entityId: inO.ref, before: { deferred: inO.ref }, after: { deferred: outO.ref }, justification: opts.reason });
    await emit(tx, "plan.edited", { planId: plan.id, orderId: inO.ref, swappedOut: outO.ref });
  });
  return { ok: true, message: `${inO.outletId} is served on ${vehicle}; ${outO.outletId} moves to the next run.` };
}

// ─────────────────────────────────────────────────────────────── publish (D-05)
export async function prePublishChecks(planId: string) {
  const [plan] = await db().select().from(t.plans).where(eq(t.plans.id, planId));
  if (!plan) throw new Error("plan not found");
  const input = await loadPlanningInput(plan.depotId as DepotId, plan.runDate);
  const trips = await tripsOf(plan.id, input);
  const violations: string[] = [];
  for (const [v, ts] of trips) {
    const chk = checkVehicleDay(input.R, v, ts, input.ctx, "LIVE", input.fuelUsed[v] ?? 0);
    if (!chk.ok) violations.push(`${v}: ${chk.code}`);
  }
  const defs = await db().select().from(t.deferrals).where(eq(t.deferrals.planId, plan.id));
  const undecided = defs.filter((d) => d.kind === "CHOSEN" && !d.decidedAt);
  return { plan, input, trips, violations, deferrals: defs, undecided };
}

export async function publishPlan(opts: { planId: string; userId: string }): Promise<MoveResult> {
  const { plan, input, violations, undecided, deferrals } = await prePublishChecks(opts.planId);
  if (plan.status !== "draft") return { ok: false, error: "Only a draft can be published." };
  if (violations.length) return { ok: false, error: `Plan breaks the rules on ${violations.join(", ")}.` };
  if (undecided.length) return { ok: false, error: `${undecided.length} chosen deferral(s) still need a decision in D-04.` };

  const byRef = new Map(input.orders.map((o) => [o.ref, o]));
  const stops = await db()
    .select({ orderId: t.tripStops.orderId, plannedArrive: t.tripStops.plannedArrive, etaMin: t.tripStops.etaMin, vehicleId: t.trips.vehicleId, tripId: t.trips.id })
    .from(t.tripStops)
    .innerJoin(t.trips, eq(t.trips.id, t.tripStops.tripId))
    .where(eq(t.trips.planId, plan.id));
  const drivers = await db().select().from(t.users).where(and(eq(t.users.role, "driver"), eq(t.users.status, "active")));
  const driverByVehicle = new Map(drivers.filter((d) => d.vehicleId).map((d) => [d.vehicleId!, d.id]));

  await db().transaction(async (tx) => {
    // older published versions of this run are superseded
    await tx
      .update(t.plans)
      .set({ status: "superseded" })
      .where(and(eq(t.plans.depotId, plan.depotId), eq(t.plans.runDate, plan.runDate), ne(t.plans.id, plan.id), inArray(t.plans.status, ["published", "draft"])));
    await tx.update(t.plans).set({ status: "published", publishedAt: businessDate(await now()), publishedBy: opts.userId }).where(eq(t.plans.id, plan.id));

    // drivers take their vehicle's trips
    for (const [vehicleId, driverId] of driverByVehicle) {
      await tx.update(t.trips).set({ driverUserId: driverId }).where(and(eq(t.trips.planId, plan.id), eq(t.trips.vehicleId, vehicleId)));
    }

    // served orders
    const served = stops.map((s) => s.orderId);
    if (served.length) await tx.update(t.orders).set({ status: "planned", updatedAt: new Date() }).where(inArray(t.orders.id, served));

    // deferred orders carry over to the next run with priority (flowchart M23)
    for (const d of deferrals) {
      const o = byRef.get(d.orderId);
      if (!o) continue;
      const unsplittable = d.reasonCode === "EXCEEDS_EVERY_VEHICLE";
      await tx
        .update(t.orders)
        .set({
          status: unsplittable ? "rejected" : "deferred",
          runDate: unsplittable ? plan.runDate : (d.newRunDate ?? plan.runDate),
          deferredYesterday: 1,
          daysSinceLastServed: o.daysSinceLastServed + 1,
          deferCount: 1,
          note: unsplittable ? "Bigger than any vehicle - the store needs to split it" : null,
          updatedAt: new Date(),
        })
        .where(eq(t.orders.id, d.orderId));
      await notify(tx, {
        type: "order.deferred",
        title: unsplittable ? `Order ${d.orderId} is too big to carry` : `Order ${d.orderId} moves to ${dayLabel(d.newRunDate ?? plan.runDate)}`,
        body: unsplittable
          ? "It is bigger than any vehicle can carry. Please split it into smaller orders."
          : explainForStore({ kind: d.kind as DeferralKind, reasonCode: d.reasonCode, justification: null }, dayLabel(d.newRunDate ?? plan.runDate)),
        link: `/store/orders/${d.orderId}`,
        severity: "late-risk",
        outletId: o.outletId,
      });
    }

    // stores with a delivery get their planned arrival
    const byOutlet = new Map<string, typeof stops>();
    for (const s of stops) {
      const o = byRef.get(s.orderId);
      if (!o) continue;
      byOutlet.set(o.outletId, [...(byOutlet.get(o.outletId) ?? []), s]);
    }
    for (const [outletId, ss] of byOutlet) {
      const first = Math.min(...ss.map((s) => s.etaMin ?? s.plannedArrive ?? 0));
      await notify(tx, {
        type: "plan.published",
        title: `Delivery ${dayLabel(plan.runDate)} around ${hhmm(first)}`,
        body: `${ss.length} order${ss.length === 1 ? "" : "s"} planned. Expected arrival ${hhmm(first)}; you can follow it live on the Track tab.`,
        link: "/store",
        outletId,
      });
    }
    await notify(tx, {
      type: "plan.published",
      title: `Plan v${plan.version} published`,
      body: `${new Set(stops.map((s) => s.tripId)).size} load lists for ${dayLabel(plan.runDate)}, in reverse stop order.`,
      link: "/dock",
      recipientRole: "loader",
      depotId: plan.depotId,
    });
    for (const [vehicleId, driverId] of driverByVehicle) {
      if (!stops.some((s) => s.vehicleId === vehicleId)) continue;
      await notify(tx, {
        type: "plan.published",
        title: `Your run for ${dayLabel(plan.runDate)} is ready`,
        body: `Open it before you leave the depot so it is saved on your phone for the dead zones.`,
        link: "/drive",
        recipientUserId: driverId,
      });
    }
    await audit(tx, { actorId: opts.userId, action: "plan.publish", entity: "plan", entityId: plan.id, after: plan.metrics });
    await emit(tx, "plan.published", { planId: plan.id, depot: plan.depotId, runDate: plan.runDate });
  });
  return { ok: true, message: `Plan v${plan.version} published to ${new Set(stops.map((s) => s.tripId)).size} load lists, drivers and stores.` };
}
