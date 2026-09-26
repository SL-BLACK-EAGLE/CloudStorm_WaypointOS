import "server-only";
import { and, asc, eq, inArray } from "@waypoint/db/orm";
import { db, t } from "../db";

/** Everything the dispatcher screens show about one stored plan, joined once. */
export async function planView(planId: string) {
  const trips = await db()
    .select({
      id: t.trips.id,
      code: t.trips.code,
      vehicleId: t.trips.vehicleId,
      tripNo: t.trips.tripNo,
      brand: t.trips.brand,
      district: t.trips.district,
      departureMin: t.trips.departureMin,
      backMin: t.trips.backMin,
      tripMinutes: t.trips.tripMinutes,
      litres: t.trips.litres,
      status: t.trips.status,
      vType: t.vehicles.type,
      vTemp: t.vehicles.temp,
      capKg: t.vehicles.weightCapKg,
      capM3: t.vehicles.volumeCapM3,
      quotaL: t.vehicles.weeklyFuelQuotaL,
    })
    .from(t.trips)
    .innerJoin(t.vehicles, eq(t.vehicles.id, t.trips.vehicleId))
    .where(eq(t.trips.planId, planId))
    .orderBy(asc(t.trips.vehicleId), asc(t.trips.tripNo));
  const tripIds = trips.map((x) => x.id);
  const stops = tripIds.length
    ? await db()
        .select({
          id: t.tripStops.id,
          tripId: t.tripStops.tripId,
          seq: t.tripStops.seq,
          orderId: t.tripStops.orderId,
          plannedArrive: t.tripStops.plannedArrive,
          expectedArrive: t.tripStops.expectedArrive,
          etaMin: t.tripStops.etaMin,
          lateRisk: t.tripStops.lateRisk,
          plannedLate: t.tripStops.plannedLate,
          status: t.tripStops.status,
          version: t.tripStops.version,
          arrivedMin: t.tripStops.arrivedMin,
          leftMin: t.tripStops.leftMin,
          outletId: t.orders.outletId,
          temp: t.orders.temp,
          units: t.orders.units,
          kg: t.orders.weightKg,
          m3: t.orders.volumeM3,
          open: t.outlets.windowOpen,
          close: t.outlets.windowClose,
          dock: t.outlets.dockType,
          parking: t.outlets.parking,
          mallWindow: t.outlets.mallWindow,
        })
        .from(t.tripStops)
        .innerJoin(t.orders, eq(t.orders.id, t.tripStops.orderId))
        .innerJoin(t.outlets, eq(t.outlets.id, t.orders.outletId))
        .where(inArray(t.tripStops.tripId, tripIds))
        .orderBy(asc(t.tripStops.seq))
    : [];
  const deferrals = await db()
    .select({
      id: t.deferrals.id,
      orderId: t.deferrals.orderId,
      kind: t.deferrals.kind,
      reasonCode: t.deferrals.reasonCode,
      lostToOrderId: t.deferrals.lostToOrderId,
      explanation: t.deferrals.explanation,
      fairness: t.deferrals.fairness,
      newRunDate: t.deferrals.newRunDate,
      decidedAt: t.deferrals.decidedAt,
      outletId: t.orders.outletId,
      brand: t.orders.brand,
      district: t.outlets.district,
      temp: t.orders.temp,
      units: t.orders.units,
      kg: t.orders.weightKg,
      m3: t.orders.volumeM3,
      parking: t.outlets.parking,
      dock: t.outlets.dockType,
      open: t.outlets.windowOpen,
      close: t.outlets.windowClose,
    })
    .from(t.deferrals)
    .innerJoin(t.orders, eq(t.orders.id, t.deferrals.orderId))
    .innerJoin(t.outlets, eq(t.outlets.id, t.orders.outletId))
    .where(eq(t.deferrals.planId, planId))
    .orderBy(asc(t.deferrals.kind), asc(t.deferrals.orderId));

  const stopsByTrip = new Map<string, typeof stops>();
  for (const s of stops) {
    const list = stopsByTrip.get(s.tripId) ?? [];
    list.push(s);
    stopsByTrip.set(s.tripId, list);
  }
  return {
    trips: trips.map((tr) => ({
      ...tr,
      stops: stopsByTrip.get(tr.id) ?? [],
      kg: (stopsByTrip.get(tr.id) ?? []).reduce((s, x) => s + x.kg, 0),
      m3: (stopsByTrip.get(tr.id) ?? []).reduce((s, x) => s + x.m3, 0),
    })),
    deferrals,
  };
}

export type PlanView = Awaited<ReturnType<typeof planView>>;
export type PlanTrip = PlanView["trips"][number];
export type PlanDeferral = PlanView["deferrals"][number];

/** The queue (open orders) for a depot and run date, with outlet facts. */
export async function queue(depot: string, runDate: string) {
  return db()
    .select({
      id: t.orders.id,
      outletId: t.orders.outletId,
      brand: t.orders.brand,
      temp: t.orders.temp,
      units: t.orders.units,
      kg: t.orders.weightKg,
      m3: t.orders.volumeM3,
      status: t.orders.status,
      intakeReason: t.orders.intakeReason,
      deferredYesterday: t.orders.deferredYesterday,
      daysSinceLastServed: t.orders.daysSinceLastServed,
      receivedAt: t.orders.receivedAt,
      source: t.orders.source,
      district: t.outlets.district,
      dock: t.outlets.dockType,
      parking: t.outlets.parking,
      mallWindow: t.outlets.mallWindow,
      open: t.outlets.windowOpen,
      close: t.outlets.windowClose,
    })
    .from(t.orders)
    .innerJoin(t.outlets, eq(t.outlets.id, t.orders.outletId))
    .where(and(eq(t.orders.depotId, depot), eq(t.orders.runDate, runDate), inArray(t.orders.status, ["confirmed", "planned", "deferred"])))
    .orderBy(asc(t.outlets.district), asc(t.orders.outletId));
}
export type QueueRow = Awaited<ReturnType<typeof queue>>[number];
