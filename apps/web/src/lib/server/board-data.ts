import "server-only";
import { loadReference } from "@waypoint/db";
import type { BoardData } from "@/app/dispatch/plan/board";
import { db, t } from "./db";
import { loadPlanningInput, type DepotId } from "./planning";
import { planView, type PlanView } from "./queries/plan-view";

type PlanRow = typeof t.plans.$inferSelect;

/** Everything the planner needs to re-check a stored plan (browser board, D-04 previews, D-05 checks). */
export async function boardData(plan: PlanRow): Promise<{ data: BoardData; view: PlanView }> {
  const depot = plan.depotId as DepotId;
  const [input, view, refInput] = await Promise.all([loadPlanningInput(depot, plan.runDate, db(), { planId: plan.id }), planView(plan.id), loadReference(db())]);
  const outletsHere = new Set(input.orders.map((o) => o.outletId));
  const data: BoardData = {
    planId: plan.id,
    planStatus: plan.status as "draft" | "published",
    version: plan.version,
    depot,
    runDate: plan.runDate,
    ref: {
      outlets: refInput.outlets.filter((o) => o.depot === depot || outletsHere.has(o.id)),
      vehicles: refInput.vehicles.filter((v) => v.depot === depot),
      districts: refInput.districts,
      allowance: refInput.allowance,
      speed: refInput.speed.filter((s) => refInput.districts.some((d) => d.name === s.district && d.depot === depot)),
    },
    ctx: input.ctx,
    status: input.status,
    fuelUsed: input.fuelUsed,
    orders: input.orders.map((o) => ({
      ref: o.ref,
      outletId: o.outletId,
      temp: o.temp,
      units: o.units,
      kg: o.kg,
      m3: o.m3,
      deferredYesterday: o.deferredYesterday,
      daysSinceLastServed: o.daysSinceLastServed,
    })),
    trips: view.trips.map((tr) => ({
      id: tr.id,
      code: tr.code,
      vehicleId: tr.vehicleId,
      tripNo: tr.tripNo,
      status: tr.status,
      departureMin: tr.departureMin,
      orderIds: tr.stops.map((s) => s.orderId),
      arrivals: Object.fromEntries(tr.stops.map((s) => [s.orderId, s.plannedArrive ?? 0])),
      lateRisk: tr.stops.filter((s) => s.lateRisk).map((s) => s.orderId),
    })),
    deferrals: view.deferrals.map((d) => ({
      orderId: d.orderId,
      kind: d.kind,
      reasonCode: d.reasonCode,
      explanation: d.explanation,
      lostToOrderId: d.lostToOrderId,
    })),
  };
  return { data, view };
}
