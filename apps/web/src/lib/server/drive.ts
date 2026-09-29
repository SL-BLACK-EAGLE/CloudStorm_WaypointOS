import "server-only";
import { and, asc, desc, eq, inArray, isNull } from "@waypoint/db/orm";
import { makeOrder, rescheduleRemaining } from "@waypoint/planner";
import type { DriverEvent, RunPack, SyncOutcome } from "@/lib/offline/types";
import { hhmm } from "@/lib/format";
import { businessDate, now, readClockSetting } from "./clock";
import { db, t } from "./db";
import { audit, emit, notify } from "./events";
import { loadPlanningInput, publishedPlan, type DepotId } from "./planning";
import { reference } from "./reference";
import { runs } from "./runs";
import type { AppUser } from "./session";

/** The run a driver works on: the active run, else the next published one. */
async function driverRunDate(depot: DepotId) {
  const r = await runs();
  if (await publishedPlan(depot, r.active)) return r.active;
  if (await publishedPlan(depot, r.planning)) return r.planning;
  return r.active;
}

/** DR-01..DR-05 offline pack: everything the phone needs to work through the dead zones. */
export async function buildPack(user: AppUser): Promise<RunPack> {
  const clock = await readClockSetting();
  const [vehicle] = user.vehicleId ? await db().select().from(t.vehicles).where(eq(t.vehicles.id, user.vehicleId)) : [];
  const base: RunPack = {
    version: 1,
    builtAt: new Date().toISOString(),
    runDate: clock.at.slice(0, 10),
    driverName: user.name,
    vehicle: vehicle ? { id: vehicle.id, type: vehicle.type, temp: vehicle.temp, capKg: vehicle.weightCapKg, depot: vehicle.depotId } : null,
    planVersion: null,
    clock,
    trips: [],
    conflicts: [],
    notices: [],
  };
  const notes = await db()
    .select()
    .from(t.notifications)
    .where(and(eq(t.notifications.recipientUserId, user.id), isNull(t.notifications.readAt)))
    .orderBy(desc(t.notifications.createdAt))
    .limit(10);
  base.notices = notes.map((n) => ({ id: n.id, title: n.title, body: n.body, severity: n.severity, at: n.createdAt.toISOString() }));
  if (!vehicle) return base;
  const runDate = await driverRunDate(vehicle.depotId as DepotId);
  const plan = await publishedPlan(vehicle.depotId as DepotId, runDate);
  base.runDate = runDate;
  if (!plan) return base;
  base.planVersion = plan.version;
  const trips = await db()
    .select()
    .from(t.trips)
    .where(and(eq(t.trips.planId, plan.id), eq(t.trips.vehicleId, vehicle.id)))
    .orderBy(asc(t.trips.tripNo));
  const tripIds = trips.map((x) => x.id);
  if (!tripIds.length) return base;
  const [stops, signs, conflicts] = await Promise.all([
    db()
      .select({
        stopId: t.tripStops.id,
        tripId: t.tripStops.tripId,
        seq: t.tripStops.seq,
        orderId: t.tripStops.orderId,
        plannedArrive: t.tripStops.plannedArrive,
        etaMin: t.tripStops.etaMin,
        lateRisk: t.tripStops.lateRisk,
        version: t.tripStops.version,
        status: t.tripStops.status,
        arrivedMin: t.tripStops.arrivedMin,
        leftMin: t.tripStops.leftMin,
        outletId: t.orders.outletId,
        brand: t.orders.brand,
        temp: t.orders.temp,
        units: t.orders.units,
        kg: t.orders.weightKg,
        m3: t.orders.volumeM3,
        outletName: t.outlets.name,
        district: t.outlets.district,
        dock: t.outlets.dockType,
        parking: t.outlets.parking,
        mallWindow: t.outlets.mallWindow,
        open: t.outlets.windowOpen,
        close: t.outlets.windowClose,
      })
      .from(t.tripStops)
      .innerJoin(t.orders, eq(t.orders.id, t.tripStops.orderId))
      .innerJoin(t.outlets, eq(t.outlets.id, t.orders.outletId))
      .where(inArray(t.tripStops.tripId, tripIds))
      .orderBy(asc(t.tripStops.seq)),
    db().select().from(t.dockSignoffs).where(inArray(t.dockSignoffs.tripId, tripIds)),
    db()
      .select({ id: t.conflicts.id, stopId: t.conflicts.stopId, kind: t.conflicts.kind, detail: t.conflicts.detail, status: t.conflicts.status, resolution: t.conflicts.resolution })
      .from(t.conflicts)
      .innerJoin(t.tripStops, eq(t.tripStops.id, t.conflicts.stopId))
      .where(inArray(t.tripStops.tripId, tripIds)),
  ]);
  base.conflicts = conflicts;
  base.trips = trips.map((tr) => ({
    tripId: tr.id,
    code: tr.code,
    tripNo: tr.tripNo,
    brand: tr.brand,
    district: tr.district,
    departureMin: tr.departureMin,
    status: tr.status,
    signedOff: signs.some((s) => s.tripId === tr.id),
    departedMin: tr.departedMin,
    stops: stops
      .filter((s) => s.tripId === tr.id)
      .map((s) => ({
        stopId: s.stopId,
        seq: s.seq,
        orderId: s.orderId,
        outletId: s.outletId,
        outletName: s.outletName,
        brand: s.brand,
        district: s.district,
        dock: s.dock,
        parking: s.parking,
        mallWindow: s.mallWindow,
        open: s.open,
        close: s.close,
        temp: s.temp,
        units: s.units,
        kg: s.kg,
        m3: s.m3,
        plannedArrive: s.plannedArrive,
        etaMin: s.etaMin,
        lateRisk: s.lateRisk,
        version: s.version,
        status: s.status,
        arrivedMin: s.arrivedMin,
        leftMin: s.leftMin,
        deferredSibling: null,
      })),
  }));
  return base;
}

// ─────────────────────────────────────────────────────────────── sync
interface StopRow {
  id: string;
  tripId: string;
  orderId: string;
  version: number;
  status: string;
  vehicleId: string;
  planId: string;
  outletId: string;
  units: number;
}

async function stopForDriver(stopId: string, vehicleId: string): Promise<StopRow | null> {
  const [s] = await db()
    .select({
      id: t.tripStops.id,
      tripId: t.tripStops.tripId,
      orderId: t.tripStops.orderId,
      version: t.tripStops.version,
      status: t.tripStops.status,
      vehicleId: t.trips.vehicleId,
      planId: t.trips.planId,
      outletId: t.orders.outletId,
      units: t.orders.units,
    })
    .from(t.tripStops)
    .innerJoin(t.trips, eq(t.trips.id, t.tripStops.tripId))
    .innerJoin(t.orders, eq(t.orders.id, t.tripStops.orderId))
    .where(eq(t.tripStops.id, stopId));
  return s && s.vehicleId === vehicleId ? s : null;
}

/** Recomputes EXPECTED ETAs for a trip's remaining stops from the last actual time (flowchart K6); skipped stops drop out. */
export async function refreshEtas(tripId: string) {
  const [trip] = await db().select().from(t.trips).where(eq(t.trips.id, tripId));
  if (!trip) return;
  const [plan] = await db().select().from(t.plans).where(eq(t.plans.id, trip.planId));
  if (!plan) return;
  const stops = await db()
    .select({ id: t.tripStops.id, orderId: t.tripStops.orderId, status: t.tripStops.status, arrivedMin: t.tripStops.arrivedMin, leftMin: t.tripStops.leftMin, seq: t.tripStops.seq })
    .from(t.tripStops)
    .where(eq(t.tripStops.tripId, tripId))
    .orderBy(asc(t.tripStops.seq))
    .then((rows) => rows.filter((r) => r.status !== "skipped"));
  const input = await loadPlanningInput(plan.depotId as DepotId, plan.runDate);
  const R = await reference();
  const orderRows = await db().select().from(t.orders).where(inArray(t.orders.id, stops.map((s) => s.orderId)));
  const byId = new Map(orderRows.map((o) => [o.id, o]));
  const orders = stops.map((s) => {
    const o = byId.get(s.orderId)!;
    return makeOrder(R, { ref: o.id, outletId: o.outletId, temp: o.temp, units: o.units, kg: o.weightKg, m3: o.volumeM3 });
  });
  const done = stops.filter((s) => s.status === "delivered" || s.status === "exception");
  const doneTimes: Array<[number, number]> = done.map((s) => [s.arrivedMin ?? 0, s.leftMin ?? s.arrivedMin ?? 0]);
  const now = trip.departedMin ?? trip.departureMin ?? 0;
  const etas = rescheduleRemaining(R, orders, doneTimes, now, input.ctx);
  for (const e of etas) {
    const s = stops.find((x) => x.orderId === e.ref);
    if (s) await db().update(t.tripStops).set({ etaMin: e.eta, lateRisk: e.risk }).where(eq(t.tripStops.id, s.id));
  }
}

/**
 * Applies a batch of offline events (F9 Q1-Q6). Each event is stored once by its id - a
 * replay is a DUPLICATE. Facts (times, PoD) are kept as recorded; if the stop changed on
 * the server since the phone last saw it, the fact still applies and a conflict is opened
 * for the dispatcher (DG-02) instead of anything being silently dropped.
 */
export async function applyEvents(user: AppUser, deviceIdIn: string, events: DriverEvent[]) {
  const results: Array<{ eventId: string; outcome: SyncOutcome; message?: string }> = [];
  const touchedTrips = new Set<string>();
  const vehicleId = user.vehicleId;
  for (const ev of [...events].sort((a, b) => a.seq - b.seq)) {
    if (!vehicleId) {
      results.push({ eventId: ev.eventId, outcome: "REJECTED", message: "No vehicle assigned" });
      continue;
    }
    const [dup] = await db().select({ id: t.syncEvents.eventId }).from(t.syncEvents).where(eq(t.syncEvents.eventId, ev.eventId));
    if (dup) {
      results.push({ eventId: ev.eventId, outcome: "DUPLICATE" });
      continue;
    }
    try {
      const outcome = await db().transaction(async (tx): Promise<SyncOutcome> => {
        let conflict: { kind: string; detail: Record<string, unknown> } | null = null;
        let stop: StopRow | null = null;
        if (ev.stopId) {
          stop = await stopForDriver(ev.stopId, vehicleId);
          if (!stop) throw new Error("That stop is not on your vehicle any more");
          if (ev.baseVersion !== undefined && ev.baseVersion !== stop.version)
            conflict = { kind: "STOP_CHANGED", detail: { phoneVersion: ev.baseVersion, serverVersion: stop.version, outletId: stop.outletId, type: ev.type } };
        }
        const [trip] = await tx.select().from(t.trips).where(eq(t.trips.id, ev.tripId));
        if (!trip || trip.vehicleId !== vehicleId) throw new Error("That trip is not on your vehicle");

        if (ev.type === "trip.depart") {
          await tx.update(t.trips).set({ status: "en_route", departedMin: ev.atMin, lastSeenMin: ev.atMin }).where(eq(t.trips.id, trip.id));
          const stops = await tx.select({ orderId: t.tripStops.orderId }).from(t.tripStops).where(eq(t.tripStops.tripId, trip.id));
          if (stops.length) await tx.update(t.orders).set({ status: "en_route", updatedAt: new Date() }).where(inArray(t.orders.id, stops.map((s) => s.orderId)));
        }
        if (ev.type === "stop.arrive" && stop) {
          await tx.update(t.tripStops).set({ status: "arrived", arrivedMin: ev.atMin }).where(eq(t.tripStops.id, stop.id));
          await tx.update(t.trips).set({ lastSeenMin: ev.atMin }).where(eq(t.trips.id, trip.id));
        }
        if (ev.type === "stop.deliver" && stop) {
          const p = ev.payload as { arrivedMin?: number; unitsHanded?: number; chilledOk?: boolean; recipientName?: string; signatureKey?: string; photoKey?: string };
          // the store may already have reported a problem for this order (it arrived by another route to the server)
          const issues = await tx.select({ id: t.receiptIssues.id }).from(t.receiptIssues).where(eq(t.receiptIssues.orderId, stop.orderId));
          if (!conflict && issues.length) conflict = { kind: "STORE_ALREADY_REPORTED", detail: { outletId: stop.outletId, issues: issues.length } };
          await tx
            .insert(t.pods)
            .values({
              stopId: stop.id,
              recipientName: p.recipientName ?? null,
              signatureKey: p.signatureKey ?? null,
              photoKey: p.photoKey ?? null,
              unitsHanded: p.unitsHanded ?? stop.units,
              chilledOk: p.chilledOk ?? null,
              arrivedMin: p.arrivedMin ?? ev.atMin,
              completedMin: ev.atMin,
              deviceId: deviceIdIn,
              eventId: ev.eventId,
            })
            .onConflictDoNothing();
          await tx.update(t.tripStops).set({ status: "delivered", arrivedMin: p.arrivedMin ?? ev.atMin, leftMin: ev.atMin }).where(eq(t.tripStops.id, stop.id));
          await tx.update(t.orders).set({ status: "delivered", updatedAt: new Date() }).where(eq(t.orders.id, stop.orderId));
          await tx.update(t.trips).set({ lastSeenMin: ev.atMin }).where(eq(t.trips.id, trip.id));
          const short = (p.unitsHanded ?? stop.units) < stop.units;
          await notify(tx, {
            type: "order.delivered",
            title: `Delivered at ${hhmm(ev.atMin)} · ${p.unitsHanded ?? stop.units} units`,
            body: `${trip.vehicleId} handed over ${p.unitsHanded ?? stop.units} of ${stop.units} units${p.recipientName ? ` to ${p.recipientName}` : ""}. Check what arrived and confirm receipt.${short ? " The driver recorded fewer units than ordered." : ""}`,
            link: `/store/receive/${stop.orderId}`,
            severity: short ? "late-risk" : "info",
            outletId: stop.outletId,
          });
        }
        if (ev.type === "stop.exception" && stop) {
          const p = ev.payload as { exceptionType?: string; note?: string; unitsReturned?: number; photoKey?: string };
          await tx.insert(t.stopExceptions).values({
            stopId: stop.id,
            type: (p.exceptionType ?? "other") as "other",
            note: p.note ?? null,
            photoKey: p.photoKey ?? null,
            unitsReturned: p.unitsReturned ?? null,
            atMin: ev.atMin,
            createdBy: user.id,
            eventId: ev.eventId,
          });
          await tx.update(t.tripStops).set({ status: "exception", arrivedMin: ev.atMin, leftMin: ev.atMin }).where(eq(t.tripStops.id, stop.id));
          await tx.update(t.orders).set({ status: "exception", updatedAt: new Date() }).where(eq(t.orders.id, stop.orderId));
          await notify(tx, {
            type: "stop.exception",
            title: `${trip.vehicleId} at ${stop.outletId}: ${(p.exceptionType ?? "problem").replaceAll("_", " ")}`,
            body: p.note ?? "The driver could not complete this delivery.",
            link: "/dispatch/live",
            severity: "exception",
            recipientRole: "dispatcher",
          });
          await notify(tx, {
            type: "stop.exception",
            title: "Delivery not completed",
            body: `The driver reported: ${(p.exceptionType ?? "problem").replaceAll("_", " ")}. The dispatcher will contact you about a new delivery.`,
            link: `/store/orders/${stop.orderId}`,
            severity: "exception",
            outletId: stop.outletId,
          });
        }

        await tx.insert(t.syncEvents).values({
          eventId: ev.eventId,
          deviceId: deviceIdIn,
          seq: ev.seq,
          userId: user.id,
          type: ev.type,
          payload: { ...ev.payload, tripId: ev.tripId, stopId: ev.stopId, atMin: ev.atMin, baseVersion: ev.baseVersion },
          occurredAt: new Date(ev.occurredAt),
          outcome: conflict ? "APPLIED_WITH_CONFLICT" : "APPLIED",
        });
        if (conflict && stop) {
          await tx.insert(t.conflicts).values({ eventId: ev.eventId, stopId: stop.id, kind: conflict.kind, detail: conflict.detail, createdAt: businessDate(await now()) });
          await notify(tx, {
            type: "sync.conflict",
            title: `Conflict after reconnect · ${stop.outletId}`,
            body:
              conflict.kind === "STOP_CHANGED"
                ? `${trip.vehicleId} recorded ${ev.type.replace("stop.", "")} offline, but the stop was changed on the plan meanwhile. Both are kept - decide which stands.`
                : `${trip.vehicleId} delivered offline, but the store had already reported a problem. Both records are kept for review.`,
            link: "/dispatch/live/conflicts",
            severity: "conflict",
            recipientRole: "dispatcher",
          });
        }
        await emit(tx, "sync.applied", { eventId: ev.eventId, type: ev.type, tripId: ev.tripId, stopId: ev.stopId, conflict: conflict?.kind ?? null });
        return conflict ? "APPLIED_WITH_CONFLICT" : "APPLIED";
      });
      touchedTrips.add(ev.tripId);
      results.push({ eventId: ev.eventId, outcome });
    } catch (e) {
      results.push({ eventId: ev.eventId, outcome: "REJECTED", message: e instanceof Error ? e.message : "Rejected" });
    }
  }
  for (const tripId of touchedTrips) await refreshEtas(tripId).catch(() => undefined);
  if (touchedTrips.size) {
    await db().transaction(async (tx) => audit(tx, { actorId: user.id, action: "sync.batch", entity: "device", entityId: deviceIdIn, after: { events: events.length } }));
  }
  return results;
}
