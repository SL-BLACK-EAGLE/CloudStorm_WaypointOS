import "server-only";
import { and, asc, eq, inArray } from "@waypoint/db/orm";
import { db, t } from "./db";
import { audit, emit } from "./events";
import { currentPlan, publishedPlan, type DepotId } from "./planning";
import { reference } from "./reference";
import { runs } from "./runs";

/** Fleet board: each vehicle's status for the run being planned, its week's fuel against quota, and its trips. */
export async function fleetView(depot: DepotId) {
  const R = await reference();
  const { planning, active } = await runs();
  const cal = R.calendar.get(planning);
  const vehicles = await db().select().from(t.vehicles).where(eq(t.vehicles.depotId, depot)).orderBy(asc(t.vehicles.id));
  const ids = vehicles.map((v) => v.id);
  const [days, fuel, draft, live] = await Promise.all([
    db()
      .select()
      .from(t.vehicleDays)
      .where(and(eq(t.vehicleDays.date, planning), inArray(t.vehicleDays.vehicleId, ids))),
    cal
      ? db()
          .select()
          .from(t.fuelLedger)
          .where(and(eq(t.fuelLedger.isoYear, cal.isoYear), eq(t.fuelLedger.isoWeek, cal.isoWeek), inArray(t.fuelLedger.vehicleId, ids)))
      : Promise.resolve([]),
    currentPlan(depot, planning),
    publishedPlan(depot, active),
  ]);
  const planIds = [draft?.id, live?.id].filter((x): x is string => !!x);
  const trips = planIds.length
    ? await db()
        .select({ planId: t.trips.planId, vehicleId: t.trips.vehicleId, code: t.trips.code, district: t.trips.district, status: t.trips.status, litres: t.trips.litres, departureMin: t.trips.departureMin })
        .from(t.trips)
        .where(inArray(t.trips.planId, planIds))
    : [];
  return {
    planning,
    active,
    week: cal ? { isoYear: cal.isoYear, isoWeek: cal.isoWeek } : null,
    draft,
    live,
    vehicles: vehicles.map((v) => {
      const day = days.find((d) => d.vehicleId === v.id);
      const planned = trips.filter((x) => x.vehicleId === v.id && x.planId === draft?.id);
      return {
        ...v,
        status: (day?.status ?? "available") as "available" | "in_workshop",
        note: day?.note ?? null,
        fuelUsed: fuel.find((f) => f.vehicleId === v.id)?.litresUsed ?? 0,
        plannedLitres: planned.reduce((n, x) => n + x.litres, 0),
        planned,
        today: trips.filter((x) => x.vehicleId === v.id && x.planId === live?.id && live?.id !== draft?.id),
      };
    }),
  };
}

/**
 * Workshop toggle for the run being planned. A vehicle carrying trips on a published plan cannot be pulled -
 * move its trips first; on a draft the dispatcher re-runs auto-plan (the tower flags it).
 */
export async function setVehicleStatus(opts: { vehicleId: string; status: "available" | "in_workshop"; note?: string; userId: string }) {
  const { planning } = await runs();
  const [v] = await db().select().from(t.vehicles).where(eq(t.vehicles.id, opts.vehicleId));
  if (!v) throw new Error("Unknown vehicle");
  if (opts.status === "in_workshop") {
    const pub = await publishedPlan(v.depotId as DepotId, planning);
    if (pub) {
      const [busy] = await db()
        .select({ code: t.trips.code })
        .from(t.trips)
        .where(and(eq(t.trips.planId, pub.id), eq(t.trips.vehicleId, v.id)));
      if (busy) throw new Error(`${v.id} runs ${busy.code} on the published plan - move its stops to another vehicle first`);
    }
  }
  const draft = await currentPlan(v.depotId as DepotId, planning);
  const hasDraftTrips = draft
    ? (await db().select({ id: t.trips.id }).from(t.trips).where(and(eq(t.trips.planId, draft.id), eq(t.trips.vehicleId, v.id)))).length > 0
    : false;
  await db().transaction(async (tx) => {
    await tx
      .insert(t.vehicleDays)
      .values({ vehicleId: v.id, date: planning, status: opts.status, note: opts.note ?? null, updatedBy: opts.userId })
      .onConflictDoUpdate({
        target: [t.vehicleDays.vehicleId, t.vehicleDays.date],
        set: { status: opts.status, note: opts.note ?? null, updatedBy: opts.userId, updatedAt: new Date() },
      });
    await audit(tx, { actorId: opts.userId, action: "vehicle.status", entity: "vehicle", entityId: v.id, after: { date: planning, status: opts.status }, justification: opts.note });
    await emit(tx, "vehicle.status", { vehicleId: v.id, date: planning, status: opts.status });
  });
  return { vehicleId: v.id, planning, rerun: opts.status === "in_workshop" && hasDraftTrips };
}
