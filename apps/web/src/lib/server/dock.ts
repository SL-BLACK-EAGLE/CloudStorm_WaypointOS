import "server-only";
import { and, asc, eq, inArray } from "@waypoint/db/orm";
import { dockSignoff } from "@waypoint/planner";
import { businessDate, now } from "./clock";
import { db, t } from "./db";
import { settleDepartureNotices } from "./departures";
import { audit, emit, notify } from "./events";
import { publishedPlan, type DepotId } from "./planning";

export type DockState = "not_started" | "loading" | "ready" | "blocked" | "signed_off" | "departed";

/** L-01: the depot's published trips for a run, by planned departure, with loading progress. */
export async function dockQueue(depot: DepotId, runDate: string) {
  const plan = await publishedPlan(depot, runDate);
  if (!plan) return { plan: null, trips: [] as DockTrip[] };
  const trips = await db()
    .select({
      id: t.trips.id,
      code: t.trips.code,
      vehicleId: t.trips.vehicleId,
      tripNo: t.trips.tripNo,
      brand: t.trips.brand,
      district: t.trips.district,
      departureMin: t.trips.departureMin,
      status: t.trips.status,
      vTemp: t.vehicles.temp,
      vType: t.vehicles.type,
      capKg: t.vehicles.weightCapKg,
      capM3: t.vehicles.volumeCapM3,
    })
    .from(t.trips)
    .innerJoin(t.vehicles, eq(t.vehicles.id, t.trips.vehicleId))
    .where(eq(t.trips.planId, plan.id))
    .orderBy(asc(t.trips.departureMin), asc(t.trips.vehicleId));
  const ids = trips.map((x) => x.id);
  if (!ids.length) return { plan, trips: [] as DockTrip[] };
  const [stops, checks, shorts, signs] = await Promise.all([
    db()
      .select({ tripId: t.tripStops.tripId, orderId: t.tripStops.orderId, seq: t.tripStops.seq, version: t.tripStops.version, units: t.orders.units, temp: t.orders.temp })
      .from(t.tripStops)
      .innerJoin(t.orders, eq(t.orders.id, t.tripStops.orderId))
      .where(inArray(t.tripStops.tripId, ids)),
    db().select().from(t.loadChecks).where(inArray(t.loadChecks.tripId, ids)),
    db().select().from(t.shortfalls).where(inArray(t.shortfalls.tripId, ids)),
    db().select().from(t.dockSignoffs).where(inArray(t.dockSignoffs.tripId, ids)),
  ]);
  return {
    plan,
    trips: trips.map((tr): DockTrip => {
      const ss = stops.filter((s) => s.tripId === tr.id);
      const loaded = checks.filter((c) => c.tripId === tr.id);
      const openShort = shorts.filter((s) => s.tripId === tr.id && s.status === "open");
      const undecided = openShort.filter((s) => !s.decision);
      const signed = signs.find((s) => s.tripId === tr.id);
      const state: DockState =
        tr.status === "en_route" || tr.status === "completed"
          ? "departed"
          : signed
            ? "signed_off"
            : undecided.length
              ? "blocked"
              : loaded.length === 0
                ? "not_started"
                : loaded.length >= ss.length
                  ? "ready"
                  : "loading";
      return {
        ...tr,
        stops: ss.length,
        units: ss.reduce((n, s) => n + s.units, 0),
        loaded: loaded.length,
        chilled: ss.some((s) => s.temp === "chilled"),
        changed: ss.some((s) => s.version > 1),
        shortfalls: openShort.length,
        state,
      };
    }),
  };
}
export interface DockTrip {
  id: string;
  code: string;
  vehicleId: string;
  tripNo: number;
  brand: "Fresh" | "Style" | "Tech";
  district: string;
  departureMin: number | null;
  status: string;
  vTemp: string;
  vType: string;
  capKg: number;
  capM3: number;
  stops: number;
  units: number;
  loaded: number;
  chilled: boolean;
  changed: boolean;
  shortfalls: number;
  state: DockState;
}

/** L-02 / L-04: one trip's load list (last stop first), checks, shortfalls and sign-off. */
export async function loadList(tripId: string) {
  const [trip] = await db()
    .select({
      id: t.trips.id,
      code: t.trips.code,
      planId: t.trips.planId,
      vehicleId: t.trips.vehicleId,
      tripNo: t.trips.tripNo,
      brand: t.trips.brand,
      district: t.trips.district,
      departureMin: t.trips.departureMin,
      status: t.trips.status,
      vTemp: t.vehicles.temp,
      vType: t.vehicles.type,
      capKg: t.vehicles.weightCapKg,
      capM3: t.vehicles.volumeCapM3,
      depotId: t.plans.depotId,
      planVersion: t.plans.version,
      planStatus: t.plans.status,
      publishedAt: t.plans.publishedAt,
    })
    .from(t.trips)
    .innerJoin(t.vehicles, eq(t.vehicles.id, t.trips.vehicleId))
    .innerJoin(t.plans, eq(t.plans.id, t.trips.planId))
    .where(eq(t.trips.id, tripId));
  if (!trip) return null;
  const [stops, checks, shorts, [signed]] = await Promise.all([
    db()
      .select({
        id: t.tripStops.id,
        seq: t.tripStops.seq,
        orderId: t.tripStops.orderId,
        version: t.tripStops.version,
        plannedArrive: t.tripStops.plannedArrive,
        outletId: t.orders.outletId,
        temp: t.orders.temp,
        units: t.orders.units,
        kg: t.orders.weightKg,
        m3: t.orders.volumeM3,
        dock: t.outlets.dockType,
        open: t.outlets.windowOpen,
        close: t.outlets.windowClose,
      })
      .from(t.tripStops)
      .innerJoin(t.orders, eq(t.orders.id, t.tripStops.orderId))
      .innerJoin(t.outlets, eq(t.outlets.id, t.orders.outletId))
      .where(eq(t.tripStops.tripId, tripId))
      .orderBy(asc(t.tripStops.seq)),
    db().select().from(t.loadChecks).where(eq(t.loadChecks.tripId, tripId)),
    db().select().from(t.shortfalls).where(eq(t.shortfalls.tripId, tripId)),
    db().select().from(t.dockSignoffs).where(eq(t.dockSignoffs.tripId, tripId)),
  ]);
  return { trip, stops, checks, shortfalls: shorts, signed: signed ?? null };
}

async function tripForUser(tripId: string, depotId: string | null) {
  const [row] = await db()
    .select({ id: t.trips.id, status: t.trips.status, vehicleId: t.trips.vehicleId, code: t.trips.code, depotId: t.plans.depotId, planStatus: t.plans.status, planId: t.plans.id })
    .from(t.trips)
    .innerJoin(t.plans, eq(t.plans.id, t.trips.planId))
    .where(eq(t.trips.id, tripId));
  if (!row) throw new Error("Trip not found");
  if (depotId && row.depotId !== depotId) throw new Error("That trip belongs to another depot");
  if (row.planStatus !== "published") throw new Error("That plan is no longer current");
  return row;
}

export async function setLoaded(opts: { tripId: string; orderId: string; loaded: boolean; userId: string; depotId: string | null }) {
  const trip = await tripForUser(opts.tripId, opts.depotId);
  if (trip.status !== "planned" && trip.status !== "loading") throw new Error("This vehicle is already signed off");
  const [order] = await db().select({ units: t.orders.units }).from(t.orders).where(eq(t.orders.id, opts.orderId));
  if (!order) throw new Error("Order not found");
  await db().transaction(async (tx) => {
    if (opts.loaded) {
      await tx
        .insert(t.loadChecks)
        .values({ tripId: opts.tripId, orderId: opts.orderId, loadedUnits: order.units, checkedBy: opts.userId })
        .onConflictDoUpdate({ target: [t.loadChecks.tripId, t.loadChecks.orderId], set: { loadedUnits: order.units, checkedAt: businessDate(await now()) } });
      await tx.update(t.trips).set({ status: "loading" }).where(and(eq(t.trips.id, opts.tripId), eq(t.trips.status, "planned")));
      await tx.update(t.orders).set({ status: "loading", updatedAt: new Date() }).where(eq(t.orders.id, opts.orderId));
    } else {
      await tx.delete(t.loadChecks).where(and(eq(t.loadChecks.tripId, opts.tripId), eq(t.loadChecks.orderId, opts.orderId)));
    }
    await emit(tx, "dock.checked", { tripId: opts.tripId, orderId: opts.orderId, loaded: opts.loaded });
  });
}

export async function flagShortfall(opts: {
  tripId: string;
  orderId: string;
  unitsOnDock: number;
  cause: "missing" | "damaged" | "not_cold";
  note?: string;
  photoKey?: string;
  userId: string;
  depotId: string | null;
}) {
  const trip = await tripForUser(opts.tripId, opts.depotId);
  const [order] = await db().select({ units: t.orders.units, outletId: t.orders.outletId }).from(t.orders).where(eq(t.orders.id, opts.orderId));
  if (!order) throw new Error("Order not found");
  const short = order.units - opts.unitsOnDock;
  if (opts.cause === "missing" && short <= 0) throw new Error("The count matches the load list - nothing is missing");
  const units = opts.cause === "missing" ? short : Math.max(short, 1);
  await db().transaction(async (tx) => {
    await tx.insert(t.shortfalls).values({
      tripId: opts.tripId,
      orderId: opts.orderId,
      kind: opts.cause === "missing" ? "missing" : "damaged",
      units,
      note: [opts.cause === "not_cold" ? "Not cold" : null, opts.note].filter(Boolean).join(" · ") || null,
      photoKey: opts.photoKey,
      reportedBy: opts.userId,
    });
    await tx.update(t.trips).set({ status: "loading" }).where(eq(t.trips.id, opts.tripId));
    await notify(tx, {
      type: "dock.shortfall",
      title: `${trip.vehicleId}: ${order.outletId} ${units} unit${units === 1 ? "" : "s"} ${opts.cause === "missing" ? "short" : opts.cause === "not_cold" ? "not cold" : "damaged"}`,
      body: `Flagged at the dock on ${trip.code}. Sign-off is locked until you hold the vehicle or send it and warn the store.`,
      link: "/dispatch/live",
      severity: "exception",
      recipientRole: "dispatcher",
      depotId: trip.depotId,
    });
    await audit(tx, { actorId: opts.userId, action: "dock.shortfall", entity: "trip", entityId: opts.tripId, after: { orderId: opts.orderId, units, cause: opts.cause } });
    await emit(tx, "dock.shortfall", { tripId: opts.tripId, orderId: opts.orderId, units });
  });
  return { units, outletId: order.outletId };
}

/** Dispatcher (D-06): hold the vehicle until the units are found, or send it and warn the store. */
export async function decideShortfall(opts: { shortfallId: string; decision: "HOLD" | "SEND_AND_WARN"; note?: string; userId: string }) {
  const [s] = await db()
    .select({ id: t.shortfalls.id, tripId: t.shortfalls.tripId, orderId: t.shortfalls.orderId, units: t.shortfalls.units, kind: t.shortfalls.kind, outletId: t.orders.outletId, code: t.trips.code, vehicleId: t.trips.vehicleId })
    .from(t.shortfalls)
    .innerJoin(t.orders, eq(t.orders.id, t.shortfalls.orderId))
    .innerJoin(t.trips, eq(t.trips.id, t.shortfalls.tripId))
    .where(eq(t.shortfalls.id, opts.shortfallId));
  if (!s) throw new Error("Shortfall not found");
  await db().transaction(async (tx) => {
    await tx
      .update(t.shortfalls)
      .set({ decision: opts.decision, decisionNote: opts.note, decidedBy: opts.userId, decidedAt: businessDate(await now()), status: opts.decision === "SEND_AND_WARN" ? "decided" : "open" })
      .where(eq(t.shortfalls.id, s.id));
    if (opts.decision === "HOLD") await tx.update(t.trips).set({ status: "held" }).where(eq(t.trips.id, s.tripId));
    if (opts.decision === "SEND_AND_WARN") {
      await notify(tx, {
        type: "order.short",
        title: `Your delivery will be ${s.units} unit${s.units === 1 ? "" : "s"} short`,
        body: `${s.kind === "missing" ? "Missing" : "Damaged"} at the depot on ${s.code}. The rest arrives as planned; the dispatcher will follow up on the ${s.units} units.`,
        link: `/store/orders/${s.orderId}`,
        severity: "late-risk",
        outletId: s.outletId,
      });
    }
    await notify(tx, {
      type: "dock.decision",
      title: opts.decision === "HOLD" ? `Hold ${s.vehicleId} until complete` : `Send ${s.vehicleId} and warn the store`,
      body: opts.note ?? (opts.decision === "HOLD" ? `Find the ${s.units} units, then sign off.` : "You can sign off now."),
      link: `/dock/${s.tripId}/sign-off`,
      recipientRole: "loader",
    });
    await audit(tx, { actorId: opts.userId, action: "dock.decision", entity: "shortfall", entityId: s.id, after: { decision: opts.decision }, justification: opts.note });
    await emit(tx, "dock.decision", { tripId: s.tripId, shortfallId: s.id, decision: opts.decision });
  });
}

/** Loader: units found after a HOLD - the order is complete again. */
export async function resolveFound(opts: { shortfallId: string; userId: string; depotId: string | null }) {
  const [s] = await db().select().from(t.shortfalls).where(eq(t.shortfalls.id, opts.shortfallId));
  if (!s) throw new Error("Shortfall not found");
  await tripForUser(s.tripId, opts.depotId);
  await db().transaction(async (tx) => {
    await tx.update(t.shortfalls).set({ status: "decided", decisionNote: `${s.decisionNote ? `${s.decisionNote} · ` : ""}units found at the dock` }).where(eq(t.shortfalls.id, s.id));
    await tx.update(t.trips).set({ status: "loading" }).where(eq(t.trips.id, s.tripId));
    await emit(tx, "dock.found", { tripId: s.tripId, shortfallId: s.id });
  });
}

/** L-04 sign-off: allowed only when every stop is loaded and every shortfall has a decision (M19-M21). */
export async function signOff(opts: { tripId: string; userId: string; depotId: string | null; reeferConfirmed: boolean }) {
  const trip = await tripForUser(opts.tripId, opts.depotId);
  const list = await loadList(opts.tripId);
  if (!list) throw new Error("Trip not found");
  if (list.signed) throw new Error("Already signed off");
  const loadedIds = new Set(list.checks.map((c) => c.orderId));
  const shortOrders = new Set(list.shortfalls.map((s) => s.orderId));
  const missing = list.stops.filter((s) => !loadedIds.has(s.orderId) && !shortOrders.has(s.orderId));
  if (missing.length) throw new Error(`${missing.length} stop(s) not loaded yet`);
  if (list.trip.vTemp === "reefer" && list.stops.some((s) => s.temp === "chilled") && !opts.reeferConfirmed)
    throw new Error("Confirm the reefer unit is running and the doors are sealed");
  const open = list.shortfalls.filter((s) => s.status === "open");
  const undecided = open.filter((s) => !s.decision);
  const decision = list.shortfalls.find((s) => s.decision)?.decision ?? null;
  const state = dockSignoff(undecided.length, undecided.length ? null : decision);
  if (state === "LOCKED") throw new Error(`Sign-off blocked · ${undecided.length} shortfall unresolved`);
  if (open.some((s) => s.decision === "HOLD")) throw new Error("The dispatcher chose to hold: mark the units found first");
  const signedAt = businessDate(await now());
  await db().transaction(async (tx) => {
    await tx.insert(t.dockSignoffs).values({ tripId: opts.tripId, state, signedBy: opts.userId, signedAt });
    await tx.update(t.trips).set({ status: "ready" }).where(eq(t.trips.id, opts.tripId));
    await notify(tx, {
      type: "dock.signed_off",
      title: `${trip.vehicleId} loaded and signed off`,
      body: `${trip.code} is ready to leave.`,
      link: "/drive",
      recipientRole: "driver",
    });
    await audit(tx, { actorId: opts.userId, action: "dock.signoff", entity: "trip", entityId: opts.tripId, after: { state } });
    await emit(tx, "dock.signed_off", { tripId: opts.tripId, state, depot: list.trip.depotId });
  });
  await settleDepartureNotices(opts.tripId, signedAt);
  return state;
}
