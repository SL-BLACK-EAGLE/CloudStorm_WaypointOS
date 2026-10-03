import "server-only";
import type { Executor } from "@waypoint/db";
import { and, asc, desc, eq, inArray, isNull, like } from "@waypoint/db/orm";
import { nextOperatingDay } from "@waypoint/planner";
import { dayLabel, hhmm } from "@/lib/format";
import { businessDate, now } from "./clock";
import { db, t } from "./db";
import { refreshEtas } from "./drive";
import { audit, emit, notify } from "./events";
import { publishedPlan, type DepotId } from "./planning";
import { reference } from "./reference";
import { runs } from "./runs";

/** A stop is at risk once its projected margin to window close drops under this many minutes. */
export const LATE_MARGIN = 20;

export interface LiveStop {
  id: string;
  seq: number;
  orderId: string;
  outletId: string;
  brand: string;
  temp: "chilled" | "ambient";
  units: number;
  open: number;
  close: number;
  plannedArrive: number | null;
  eta: number | null;
  margin: number | null;
  risk: boolean;
  status: "planned" | "arrived" | "delivered" | "exception" | "skipped";
  arrivedMin: number | null;
  leftMin: number | null;
  version: number;
  allowance: number;
}

export type TripLabel = "Complete" | "Held at dock" | "Not departed" | "Long stop" | "Late risk" | "At stop" | "En route" | "Ready" | "Loading" | "Planned";

export interface LiveTrip {
  id: string;
  code: string;
  vehicleId: string;
  tripNo: number;
  brand: string;
  district: string;
  status: string;
  label: TripLabel;
  rank: number;
  departureMin: number | null;
  departedMin: number | null;
  driverUserId: string | null;
  delivered: number;
  total: number;
  drift: number | null;
  next: LiveStop | null;
  riskStops: LiveStop[];
  lastEvent: string;
  stops: LiveStop[];
}

export type LiveException =
  | { kind: "not_departed"; key: string; trip: LiveTrip; late: number }
  | { kind: "long_stop"; key: string; trip: LiveTrip; stop: LiveStop; minutes: number }
  | { kind: "late_risk"; key: string; trip: LiveTrip; stops: Array<LiveStop & { warned: boolean }> }
  | { kind: "shortfall"; key: string; id: string; trip: LiveTrip; orderId: string; outletId: string; units: number; shortKind: string; note: string | null; photoKey: string | null }
  | { kind: "stop_exception"; key: string; id: string; trip: LiveTrip; stop: LiveStop; type: string; note: string | null; photoKey: string | null; atMin: number | null }
  | { kind: "receipt"; key: string; orderId: string; outletId: string; units: number; received: number; issues: string; photoKey: string | null; note: string | null }
  | { kind: "message"; key: string; id: string; orderId: string; outletId: string; body: string; at: Date };

/** The run the live screen watches: today's published plan, else the next one (the demo starts the evening before). */
export async function liveRun(depot: DepotId) {
  const { active, planning, clock } = await runs();
  for (const d of [active, planning]) {
    const p = await publishedPlan(depot, d);
    if (p) return { plan: p, clock };
  }
  return { plan: null, clock };
}

const RANK: Record<TripLabel, number> = {
  "Not departed": 0,
  "Long stop": 0,
  "Held at dock": 0,
  "Late risk": 1,
  "At stop": 2,
  "En route": 2,
  Ready: 3,
  Loading: 3,
  Planned: 3,
  Complete: 4,
};

/** D-06: every trip of the watched plan ranked by risk, plus the feed of things that need a person. */
export async function liveBoard(depot: DepotId) {
  const { plan, clock } = await liveRun(depot);
  if (!plan) return null;
  // minutes into the run day; before the day starts nothing can be late yet
  const nowMin = clock.date === plan.runDate ? clock.minute : clock.date > plan.runDate ? 24 * 60 : null;

  const trips = await db().select().from(t.trips).where(eq(t.trips.planId, plan.id)).orderBy(asc(t.trips.vehicleId), asc(t.trips.tripNo));
  const tripIds = trips.map((x) => x.id);
  if (!tripIds.length) return { plan, clock, nowMin, trips: [] as LiveTrip[], exceptions: [] as LiveException[], openConflicts: 0, kpi: kpis([]) };

  const [stops, allowances, shorts, excs, conflicts] = await Promise.all([
    db()
      .select({
        id: t.tripStops.id,
        tripId: t.tripStops.tripId,
        seq: t.tripStops.seq,
        orderId: t.tripStops.orderId,
        plannedArrive: t.tripStops.plannedArrive,
        etaMin: t.tripStops.etaMin,
        status: t.tripStops.status,
        arrivedMin: t.tripStops.arrivedMin,
        leftMin: t.tripStops.leftMin,
        version: t.tripStops.version,
        outletId: t.orders.outletId,
        brand: t.orders.brand,
        temp: t.orders.temp,
        units: t.orders.units,
        dock: t.outlets.dockType,
        open: t.outlets.windowOpen,
        close: t.outlets.windowClose,
      })
      .from(t.tripStops)
      .innerJoin(t.orders, eq(t.orders.id, t.tripStops.orderId))
      .innerJoin(t.outlets, eq(t.outlets.id, t.orders.outletId))
      .where(inArray(t.tripStops.tripId, tripIds))
      .orderBy(asc(t.tripStops.seq)),
    db().select().from(t.serviceAllowances),
    db()
      .select({ s: t.shortfalls, outletId: t.orders.outletId })
      .from(t.shortfalls)
      .innerJoin(t.orders, eq(t.orders.id, t.shortfalls.orderId))
      .where(and(inArray(t.shortfalls.tripId, tripIds), eq(t.shortfalls.status, "open"))),
    db()
      .select({ e: t.stopExceptions, tripId: t.tripStops.tripId })
      .from(t.stopExceptions)
      .innerJoin(t.tripStops, eq(t.tripStops.id, t.stopExceptions.stopId))
      .where(and(inArray(t.tripStops.tripId, tripIds), eq(t.stopExceptions.resolved, false))),
    db()
      .select({ id: t.conflicts.id })
      .from(t.conflicts)
      .innerJoin(t.tripStops, eq(t.tripStops.id, t.conflicts.stopId))
      .where(and(inArray(t.tripStops.tripId, tripIds), eq(t.conflicts.status, "open"))),
  ]);
  const allow = new Map(allowances.map((a) => [`${a.brand}|${a.dockType}`, a.minutes]));
  const orderIds = stops.map((s) => s.orderId);

  const [receipts, issues, msgs, handled] = await Promise.all([
    db()
      .select()
      .from(t.receipts)
      .where(and(inArray(t.receipts.orderId, orderIds), eq(t.receipts.status, "problem"))),
    db().select().from(t.receiptIssues).where(inArray(t.receiptIssues.orderId, orderIds)),
    db()
      .select({ m: t.messages, role: t.users.role })
      .from(t.messages)
      .leftJoin(t.users, eq(t.users.id, t.messages.authorId))
      .where(and(eq(t.messages.threadType, "order"), inArray(t.messages.threadId, orderIds)))
      .orderBy(desc(t.messages.createdAt)),
    db()
      .select({ action: t.auditLog.action, entityId: t.auditLog.entityId })
      .from(t.auditLog)
      .where(inArray(t.auditLog.action, ["live.receipt_handled", "live.message_handled", "live.warn_store"])),
  ]);
  const done = new Set(handled.map((h) => `${h.action}|${h.entityId}`));

  const live: LiveTrip[] = trips.map((tr) => {
    const ss = stops.filter((s) => s.tripId === tr.id);
    // how late the trip is running: the last recorded arrival against its plan, or a late departure
    const lastDone = [...ss].reverse().find((s) => s.arrivedMin !== null && s.plannedArrive !== null);
    const lateStart =
      tr.departedMin !== null && tr.departureMin !== null
        ? tr.departedMin - tr.departureMin
        : nowMin !== null && tr.departureMin !== null && nowMin > tr.departureMin && tr.status !== "en_route"
          ? nowMin - tr.departureMin
          : null;
    const drift = lastDone ? lastDone.arrivedMin! - lastDone.plannedArrive! : lateStart;
    const liveStops: LiveStop[] = ss.map((s) => {
      const finished = s.status === "delivered" || s.status === "exception" || s.status === "skipped";
      const projected = s.plannedArrive === null ? null : Math.max(s.etaMin ?? s.plannedArrive, s.plannedArrive + Math.max(0, drift ?? 0));
      const eta = finished ? s.arrivedMin : s.status === "arrived" ? s.arrivedMin : projected;
      const margin = eta === null ? null : Math.round(s.close - eta);
      return {
        id: s.id,
        seq: s.seq,
        orderId: s.orderId,
        outletId: s.outletId,
        brand: s.brand,
        temp: s.temp,
        units: s.units,
        open: s.open,
        close: s.close,
        plannedArrive: s.plannedArrive,
        eta,
        margin,
        risk: !finished && margin !== null && margin < LATE_MARGIN,
        status: s.status,
        arrivedMin: s.arrivedMin,
        leftMin: s.leftMin,
        version: s.version,
        allowance: allow.get(`${s.brand}|${s.dock}`) ?? 20,
      };
    });
    const remaining = liveStops.filter((s) => s.status === "planned" || s.status === "arrived");
    const atStop = liveStops.find((s) => s.status === "arrived");
    const longStop = atStop && nowMin !== null && atStop.arrivedMin !== null && nowMin - atStop.arrivedMin > Math.max(2 * atStop.allowance, atStop.allowance + 15);
    const notLeft = tr.status !== "en_route" && tr.status !== "completed" && nowMin !== null && tr.departureMin !== null && nowMin > tr.departureMin + 5;
    const label: TripLabel =
      tr.status === "completed" || (remaining.length === 0 && liveStops.length > 0)
        ? "Complete"
        : tr.status === "held"
          ? "Held at dock"
          : notLeft
            ? "Not departed"
            : longStop
              ? "Long stop"
              : remaining.some((s) => s.risk)
                ? "Late risk"
                : atStop
                  ? "At stop"
                  : tr.status === "en_route"
                    ? "En route"
                    : tr.status === "ready"
                      ? "Ready"
                      : tr.status === "loading"
                        ? "Loading"
                        : "Planned";
    const events: Array<[number, string]> = [];
    if (tr.departedMin !== null) events.push([tr.departedMin, `${hhmm(tr.departedMin)} departed`]);
    for (const s of liveStops) {
      if (s.arrivedMin !== null) events.push([s.arrivedMin, `${hhmm(s.arrivedMin)} arr ${s.outletId}`]);
      if (s.leftMin !== null && s.status !== "exception") events.push([s.leftMin + 0.01, `${hhmm(s.leftMin)} left ${s.outletId}`]);
      if (s.status === "exception") events.push([(s.leftMin ?? 0) + 0.02, `${hhmm(s.leftMin)} problem at ${s.outletId}`]);
    }
    events.sort((a, b) => b[0] - a[0]);
    return {
      id: tr.id,
      code: tr.code,
      vehicleId: tr.vehicleId,
      tripNo: tr.tripNo,
      brand: tr.brand,
      district: tr.district,
      status: tr.status,
      label,
      rank: RANK[label],
      departureMin: tr.departureMin,
      departedMin: tr.departedMin,
      driverUserId: tr.driverUserId,
      delivered: liveStops.filter((s) => s.status === "delivered").length,
      total: liveStops.filter((s) => s.status !== "skipped").length,
      drift: drift === null ? null : Math.round(drift),
      next: remaining[0] ?? null,
      riskStops: remaining.filter((s) => s.risk),
      lastEvent: events[0]?.[1] ?? (tr.departureMin !== null ? `Plan dep ${hhmm(tr.departureMin)}` : "—"),
      stops: liveStops,
    };
  });
  live.sort((a, b) => a.rank - b.rank || (b.drift ?? -999) - (a.drift ?? -999) || (a.code < b.code ? -1 : 1));

  const byTrip = new Map(live.map((x) => [x.id, x]));
  const stopById = new Map(live.flatMap((x) => x.stops.map((s) => [s.id, s] as const)));
  const exceptions: LiveException[] = [];
  for (const { s, outletId } of shorts) {
    if (s.decision) continue;
    exceptions.push({ kind: "shortfall", key: `sf-${s.id}`, id: s.id, trip: byTrip.get(s.tripId)!, orderId: s.orderId, outletId, units: s.units, shortKind: s.kind, note: s.note, photoKey: s.photoKey });
  }
  for (const { e, tripId } of excs) {
    const trip = byTrip.get(tripId)!;
    exceptions.push({ kind: "stop_exception", key: `ex-${e.id}`, id: e.id, trip, stop: stopById.get(e.stopId)!, type: e.type, note: e.note, photoKey: e.photoKey, atMin: e.atMin });
  }
  for (const tr of live) {
    if (tr.label === "Not departed") exceptions.push({ kind: "not_departed", key: `nd-${tr.id}`, trip: tr, late: Math.round((nowMin ?? 0) - (tr.departureMin ?? 0)) });
    const at = tr.stops.find((s) => s.status === "arrived");
    if (tr.label === "Long stop" && at) exceptions.push({ kind: "long_stop", key: `ls-${at.id}`, trip: tr, stop: at, minutes: Math.round((nowMin ?? 0) - (at.arrivedMin ?? 0)) });
    // one card per trip; a truck still at the dock is already an exception of its own
    if (tr.riskStops.length && tr.rank > 0)
      exceptions.push({ kind: "late_risk", key: `lr-${tr.id}`, trip: tr, stops: tr.riskStops.map((s) => ({ ...s, warned: done.has(`live.warn_store|${s.id}`) })) });
  }
  for (const r of receipts) {
    if (done.has(`live.receipt_handled|${r.orderId}`)) continue;
    const st = [...stopById.values()].find((s) => s.orderId === r.orderId)!;
    const its = issues.filter((i) => i.orderId === r.orderId);
    exceptions.push({
      kind: "receipt",
      key: `rc-${r.orderId}`,
      orderId: r.orderId,
      outletId: st.outletId,
      units: st.units,
      received: r.unitsReceived,
      issues: its.map((i) => `${i.units} ${i.kind.replace("_", " ")}`).join(", "),
      photoKey: its.find((i) => i.photoKey)?.photoKey ?? null,
      note: r.note,
    });
  }
  const answered = new Set<string>();
  for (const { m, role } of msgs) {
    // a thread is answered once the dispatcher has written after the store's latest message
    if (role === "dispatcher") answered.add(m.threadId);
    if (role !== "store_manager" || answered.has(m.threadId) || done.has(`live.message_handled|${m.id}`)) continue;
    answered.add(m.threadId);
    const st = [...stopById.values()].find((s) => s.orderId === m.threadId);
    exceptions.push({ kind: "message", key: `ms-${m.id}`, id: m.id, orderId: m.threadId, outletId: st?.outletId ?? "", body: m.body, at: m.createdAt });
  }
  const ORDER: Record<LiveException["kind"], number> = { shortfall: 0, stop_exception: 1, not_departed: 2, long_stop: 3, receipt: 4, message: 5, late_risk: 6 };
  const worst = (e: LiveException) => (e.kind === "late_risk" ? Math.min(...e.stops.map((s) => s.margin ?? 0)) : 0);
  exceptions.sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || worst(a) - worst(b));

  return { plan, clock, nowMin, trips: live, exceptions, openConflicts: conflicts.length, kpi: kpis(live) };
}

function kpis(trips: LiveTrip[]) {
  const risky = trips.filter((x) => x.riskStops.length);
  return {
    trips: trips.length,
    departed: trips.filter((x) => x.departedMin !== null || x.label === "Complete").length,
    stops: trips.reduce((n, x) => n + x.total, 0),
    delivered: trips.reduce((n, x) => n + x.delivered, 0),
    riskStops: risky.reduce((n, x) => n + x.riskStops.length, 0),
    riskTrips: risky.length,
    needsAction: trips.filter((x) => x.rank === 0).length,
  };
}

// ─────────────────────────────────────────────────────────────── actions

async function stopContext(stopId: string) {
  const [s] = await db()
    .select({
      id: t.tripStops.id,
      status: t.tripStops.status,
      version: t.tripStops.version,
      etaMin: t.tripStops.etaMin,
      plannedArrive: t.tripStops.plannedArrive,
      orderId: t.tripStops.orderId,
      tripId: t.trips.id,
      code: t.trips.code,
      vehicleId: t.trips.vehicleId,
      driverUserId: t.trips.driverUserId,
      planId: t.plans.id,
      runDate: t.plans.runDate,
      depotId: t.plans.depotId,
      outletId: t.orders.outletId,
      units: t.orders.units,
      close: t.outlets.windowClose,
    })
    .from(t.tripStops)
    .innerJoin(t.trips, eq(t.trips.id, t.tripStops.tripId))
    .innerJoin(t.plans, eq(t.plans.id, t.trips.planId))
    .innerJoin(t.orders, eq(t.orders.id, t.tripStops.orderId))
    .innerJoin(t.outlets, eq(t.outlets.id, t.orders.outletId))
    .where(eq(t.tripStops.id, stopId));
  if (!s) throw new Error("Stop not found");
  return s;
}

/** Tell one store its new ETA before it notices the truck is late. */
export async function warnStore(opts: { stopId: string; userId: string }) {
  const s = await stopContext(opts.stopId);
  const board = await liveBoard(s.depotId as DepotId);
  const eta = board?.trips.flatMap((x) => x.stops).find((x) => x.id === s.id)?.eta ?? s.etaMin ?? s.plannedArrive;
  await db().transaction(async (tx) => {
    await notify(tx, {
      type: "order.late",
      title: `Running late · now around ${hhmm(eta)}`,
      body: `${s.vehicleId} is behind schedule. Your delivery is now expected around ${hhmm(eta)}${eta !== null && eta > s.close ? `, after your ${hhmm(s.close)} close` : ""}. Reply here if that does not work.`,
      link: `/store/orders/${s.orderId}`,
      severity: "late-risk",
      outletId: s.outletId,
    });
    await audit(tx, { actorId: opts.userId, action: "live.warn_store", entity: "stop", entityId: s.id, after: { eta } });
  });
  return { outletId: s.outletId, eta };
}

/** Send every remaining store on a trip its new ETA (e.g. after a long stop). */
export async function warnTripStores(opts: { tripId: string; userId: string; depot: DepotId }) {
  const board = await liveBoard(opts.depot);
  const trip = board?.trips.find((x) => x.id === opts.tripId);
  if (!trip) throw new Error("Trip not found");
  const remaining = trip.stops.filter((s) => s.status === "planned");
  await db().transaction(async (tx) => {
    for (const s of remaining) {
      await notify(tx, {
        type: "order.late",
        title: `New arrival time · around ${hhmm(s.eta)}`,
        body: `${trip.vehicleId} was held up at an earlier stop. Your delivery is now expected around ${hhmm(s.eta)}.`,
        link: `/store/orders/${s.orderId}`,
        severity: s.risk ? "late-risk" : "info",
        outletId: s.outletId,
      });
      await tx.insert(t.auditLog).values({ actorId: opts.userId, action: "live.warn_store", entity: "stop", entityId: s.id, after: { eta: s.eta } });
    }
  });
  return remaining.length;
}

/**
 * "Defer to <next run>": an en-route stop is taken off today's trip. The stop is marked skipped and its version
 * bumped (a driver offline still holding the old version gets a conflict, DG-02), the order moves to the next run
 * with priority, and the store and driver are told.
 */
export async function deferStop(opts: { stopId: string; userId: string; reason: string }) {
  const s = await stopContext(opts.stopId);
  if (s.status !== "planned" && s.status !== "arrived") throw new Error("Only a stop that has not been delivered can move");
  const R = await reference();
  const next = nextOperatingDay(R, s.runDate);
  const at = await now();
  await db().transaction(async (tx) => {
    await tx
      .update(t.tripStops)
      .set({ status: "skipped", version: s.version + 1 })
      .where(eq(t.tripStops.id, s.id));
    await tx.update(t.orders).set({ status: "deferred", runDate: next, deferredYesterday: 1, updatedAt: businessDate(at) }).where(eq(t.orders.id, s.orderId));
    await tx.insert(t.deferrals).values({
      planId: s.planId,
      orderId: s.orderId,
      kind: "MANUAL",
      reasonCode: "LIVE_LATE_RISK",
      explanation: `Moved during the run at ${hhmm(at.minute)}: ${opts.reason}`,
      newRunDate: next,
      decidedBy: opts.userId,
      decidedAt: businessDate(at),
    });
    await notify(tx, {
      type: "order.deferred",
      title: `Today's delivery moves to ${dayLabel(next)}`,
      body: `${s.vehicleId} is running too late to reach you inside your window. Your order ${s.orderId} goes first on ${dayLabel(next)}'s run. ${opts.reason}`,
      link: `/store/orders/${s.orderId}`,
      severity: "late-risk",
      outletId: s.outletId,
    });
    if (s.driverUserId)
      await notify(tx, {
        type: "stop.skipped",
        title: `Skip ${s.outletId} - moved to ${dayLabel(next)}`,
        body: `Keep ${s.orderId} (${s.units} units) on board and bring it back to the depot. Go straight to your next stop.`,
        link: "/drive",
        severity: "conflict",
        recipientUserId: s.driverUserId,
      });
    await audit(tx, { actorId: opts.userId, action: "live.defer_stop", entity: "stop", entityId: s.id, after: { newRunDate: next }, justification: opts.reason });
    await emit(tx, "stop.changed", { stopId: s.id, tripId: s.tripId, status: "skipped", version: s.version + 1 });
  });
  await refreshEtas(s.tripId).catch(() => undefined);
  return { next, outletId: s.outletId };
}

/** Undo of deferStop for DG-02 "Deliver today": the stop is back on the trip and the next-run slot is freed. */
async function restoreStop(tx: Executor, stopId: string) {
  const s = await stopContext(stopId);
  await tx
    .update(t.tripStops)
    .set({ status: "planned", version: s.version + 1 })
    .where(eq(t.tripStops.id, s.id));
  await tx.update(t.orders).set({ status: "en_route", runDate: s.runDate, deferredYesterday: 0 }).where(eq(t.orders.id, s.orderId));
  await tx.delete(t.deferrals).where(and(eq(t.deferrals.planId, s.planId), eq(t.deferrals.orderId, s.orderId), eq(t.deferrals.reasonCode, "LIVE_LATE_RISK")));
  return s;
}

/** Dispatcher message to the driver of a trip (shows on the phone at the next sync). */
export async function messageDriver(opts: { tripId: string; userId: string; body: string }) {
  const [tr] = await db().select().from(t.trips).where(eq(t.trips.id, opts.tripId));
  if (!tr) throw new Error("Trip not found");
  const at = await now();
  await db().transaction(async (tx) => {
    await tx.insert(t.messages).values({ threadType: "trip", threadId: tr.id, authorId: opts.userId, body: opts.body, createdAt: businessDate(at) });
    if (tr.driverUserId)
      await notify(tx, { type: "message", title: `Dispatcher · ${tr.code}`, body: opts.body, link: "/drive", recipientUserId: tr.driverUserId });
  });
  return { hasDriver: !!tr.driverUserId, vehicleId: tr.vehicleId };
}

/** Reply to a store's message about an order. */
export async function replyStore(opts: { orderId: string; userId: string; body: string }) {
  const [o] = await db().select().from(t.orders).where(eq(t.orders.id, opts.orderId));
  if (!o) throw new Error("Order not found");
  const at = await now();
  await db().transaction(async (tx) => {
    await tx.insert(t.messages).values({ threadType: "order", threadId: o.id, authorId: opts.userId, body: opts.body, createdAt: businessDate(at) });
    await notify(tx, { type: "message", title: `Dispatcher replied about ${o.id}`, body: opts.body, link: `/store/orders/${o.id}`, outletId: o.outletId });
  });
}

/** Close a driver-reported stop exception: either handled, or the order goes on the next run. */
export async function closeException(opts: { exceptionId: string; userId: string; outcome: "closed" | "next_run" }) {
  const [e] = await db().select().from(t.stopExceptions).where(eq(t.stopExceptions.id, opts.exceptionId));
  if (!e) throw new Error("Exception not found");
  const s = await stopContext(e.stopId);
  const R = await reference();
  const next = nextOperatingDay(R, s.runDate);
  const at = await now();
  await db().transaction(async (tx) => {
    await tx.update(t.stopExceptions).set({ resolved: true }).where(eq(t.stopExceptions.id, e.id));
    if (opts.outcome === "next_run") {
      await tx.update(t.orders).set({ status: "deferred", runDate: next, deferredYesterday: 1, updatedAt: businessDate(at) }).where(eq(t.orders.id, s.orderId));
      await tx.insert(t.deferrals).values({
        planId: s.planId,
        orderId: s.orderId,
        kind: "MANUAL",
        reasonCode: "LIVE_REDELIVERY",
        explanation: `Not delivered (${e.type.replaceAll("_", " ")}); re-delivered with priority on ${dayLabel(next)}.`,
        newRunDate: next,
        decidedBy: opts.userId,
        decidedAt: businessDate(at),
      });
      await notify(tx, {
        type: "order.deferred",
        title: `Re-delivery booked for ${dayLabel(next)}`,
        body: `Today's delivery could not be completed (${e.type.replaceAll("_", " ")}). Your order ${s.orderId} goes first on ${dayLabel(next)}'s run.`,
        link: `/store/orders/${s.orderId}`,
        severity: "late-risk",
        outletId: s.outletId,
      });
    }
    await audit(tx, { actorId: opts.userId, action: "live.close_exception", entity: "stop_exception", entityId: e.id, after: { outcome: opts.outcome } });
  });
  return { outcome: opts.outcome, next };
}

export async function markHandled(opts: { kind: "receipt" | "message"; id: string; userId: string }) {
  await db().transaction((tx) => audit(tx, { actorId: opts.userId, action: `live.${opts.kind}_handled`, entity: opts.kind, entityId: opts.id }));
}

// ─────────────────────────────────────────────────────────────── DG-02 reconciliation

export interface ConflictCard {
  id: string;
  kind: string;
  status: string;
  resolution: string | null;
  createdAt: Date;
  detail: Record<string, unknown>;
  stop: Awaited<ReturnType<typeof stopContext>> & { arrivedMin: number | null };
  deferral: { explanation: string; newRunDate: string | null; decidedAt: Date | null } | null;
}

/** Everything DG-02 needs: open conflicts with both sides, and the offline timeline of each affected trip. */
export async function reconciliation(depot: DepotId) {
  const rows = await db()
    .select({ c: t.conflicts, depotId: t.plans.depotId, tripId: t.trips.id })
    .from(t.conflicts)
    .innerJoin(t.tripStops, eq(t.tripStops.id, t.conflicts.stopId))
    .innerJoin(t.trips, eq(t.trips.id, t.tripStops.tripId))
    .innerJoin(t.plans, eq(t.plans.id, t.trips.planId))
    .where(eq(t.plans.depotId, depot))
    .orderBy(desc(t.conflicts.createdAt));
  const cards: ConflictCard[] = [];
  for (const { c } of rows) {
    const s = await stopContext(c.stopId!);
    const [st] = await db().select({ arrivedMin: t.tripStops.arrivedMin }).from(t.tripStops).where(eq(t.tripStops.id, s.id));
    const [d] = await db()
      .select()
      .from(t.deferrals)
      .where(and(eq(t.deferrals.planId, s.planId), eq(t.deferrals.orderId, s.orderId)));
    cards.push({
      id: c.id,
      kind: c.kind,
      status: c.status,
      resolution: c.resolution,
      createdAt: c.createdAt,
      detail: c.detail,
      stop: { ...s, arrivedMin: st?.arrivedMin ?? null },
      deferral: d ? { explanation: d.explanation, newRunDate: d.newRunDate, decidedAt: d.decidedAt } : null,
    });
  }
  // the trips involved, with what their drivers recorded while offline (times as recorded)
  const tripIds = [...new Set(rows.map((r) => r.tripId))];
  const timeline = tripIds.length
    ? await db()
        .select({
          tripId: t.tripStops.tripId,
          outletId: t.orders.outletId,
          status: t.tripStops.status,
          arrivedMin: t.tripStops.arrivedMin,
          leftMin: t.tripStops.leftMin,
          close: t.outlets.windowClose,
          units: t.pods.unitsHanded,
          seq: t.tripStops.seq,
        })
        .from(t.tripStops)
        .innerJoin(t.orders, eq(t.orders.id, t.tripStops.orderId))
        .innerJoin(t.outlets, eq(t.outlets.id, t.orders.outletId))
        .leftJoin(t.pods, eq(t.pods.stopId, t.tripStops.id))
        .where(inArray(t.tripStops.tripId, tripIds))
        .orderBy(asc(t.tripStops.seq))
    : [];
  const syncs = tripIds.length
    ? await db()
        .select({ outcome: t.syncEvents.outcome, occurredAt: t.syncEvents.occurredAt, receivedAt: t.syncEvents.receivedAt, payload: t.syncEvents.payload })
        .from(t.syncEvents)
        .orderBy(desc(t.syncEvents.receivedAt))
        .limit(200)
    : [];
  const trips = tripIds.length ? await db().select().from(t.trips).where(inArray(t.trips.id, tripIds)) : [];
  return {
    cards,
    trips: trips.map((tr) => {
      const recs = syncs.filter((e) => (e.payload as { tripId?: string }).tripId === tr.id);
      return {
        id: tr.id,
        code: tr.code,
        vehicleId: tr.vehicleId,
        district: tr.district,
        lastSeenMin: tr.lastSeenMin,
        received: recs.length,
        conflicts: recs.filter((e) => e.outcome === "APPLIED_WITH_CONFLICT").length,
        stops: timeline.filter((x) => x.tripId === tr.id),
      };
    }),
  };
}

/**
 * DG-02 decision. For a stop the dispatcher moved while the truck was offline:
 * - deliver_today: the move is undone, the store is asked to accept a late delivery, the driver is told to go.
 * - keep_next_run: the move stands; the driver brings the goods back.
 * For other conflicts (a fact recorded against a changed stop): accept_recorded keeps the driver's record.
 */
export async function resolveConflict(opts: { conflictId: string; resolution: "deliver_today" | "keep_next_run" | "accept_recorded"; userId: string; note?: string }) {
  const [c] = await db().select().from(t.conflicts).where(eq(t.conflicts.id, opts.conflictId));
  if (!c || !c.stopId) throw new Error("Conflict not found");
  if (c.status === "resolved") throw new Error("Already decided");
  const s = await stopContext(c.stopId);
  const at = await now();
  const text =
    opts.resolution === "deliver_today"
      ? "Deliver today - the move to the next run is cancelled"
      : opts.resolution === "keep_next_run"
        ? "Keep the next run - bring the goods back"
        : "Driver's record accepted as recorded";
  await db().transaction(async (tx) => {
    if (opts.resolution === "deliver_today" && s.status === "skipped") await restoreStop(tx, s.id);
    await tx
      .update(t.conflicts)
      .set({ status: "resolved", resolution: text, resolvedBy: opts.userId, resolvedAt: businessDate(at) })
      .where(eq(t.conflicts.id, c.id));
    // any other open conflict on the same stop is settled by the same decision
    await tx
      .update(t.conflicts)
      .set({ status: "resolved", resolution: text, resolvedBy: opts.userId, resolvedAt: businessDate(at) })
      .where(and(eq(t.conflicts.stopId, s.id), eq(t.conflicts.status, "open")));
    // the decision supersedes the earlier "skip" instruction on the phone
    if (s.driverUserId)
      await tx
        .update(t.notifications)
        .set({ readAt: businessDate(at) })
        .where(and(eq(t.notifications.recipientUserId, s.driverUserId), eq(t.notifications.type, "stop.skipped"), like(t.notifications.title, `Skip ${s.outletId} %`), isNull(t.notifications.readAt)));
    if (s.driverUserId)
      await notify(tx, {
        type: "conflict.resolved",
        title: opts.resolution === "deliver_today" ? `Deliver ${s.outletId} now` : opts.resolution === "keep_next_run" ? `Keep ${s.outletId} for the next run` : `Your record for ${s.outletId} stands`,
        body:
          opts.resolution === "deliver_today"
            ? `The dispatcher cancelled the move and the store agreed to take it today.${opts.note ? ` ${opts.note}` : ""}`
            : opts.resolution === "keep_next_run"
              ? `Keep ${s.orderId} (${s.units} units) on board and bring it back to the depot.${opts.note ? ` ${opts.note}` : ""}`
              : "The dispatcher reviewed the change and kept what you recorded.",
        link: "/drive",
        severity: opts.resolution === "keep_next_run" ? "conflict" : "info",
        recipientUserId: s.driverUserId,
      });
    if (opts.resolution === "deliver_today")
      await notify(tx, {
        type: "order.restored",
        title: "Your delivery is coming today after all",
        body: `${s.vehicleId} is close and can still deliver ${s.orderId} today${(await now()).minute > s.close ? `, after your ${hhmm(s.close)} close` : `, before your ${hhmm(s.close)} close`}. The move to the next run is withdrawn - tell the dispatcher if you cannot receive it.`,
        link: `/store/orders/${s.orderId}`,
        severity: "late-risk",
        outletId: s.outletId,
      });
    await audit(tx, { actorId: opts.userId, action: "conflict.resolve", entity: "conflict", entityId: c.id, after: { resolution: opts.resolution }, justification: opts.note });
    await emit(tx, "conflict.resolved", { conflictId: c.id, stopId: s.id, resolution: opts.resolution });
  });
  if (opts.resolution === "deliver_today") await refreshEtas(s.tripId).catch(() => undefined);
  return { text, outletId: s.outletId };
}

// ─────────────────────────────────────────────────────────────── DG-02 → DG-03: ask the store

interface StoreAsk {
  askedAt: string;
  askedMin: number;
  eta: number;
  by: string;
}
interface StoreAnswer {
  accept: boolean;
  at: string;
  atMin: number;
  by: string;
}
const askOf = (detail: unknown) => (detail as { storeAsk?: StoreAsk } | null)?.storeAsk ?? null;
const answerOf = (detail: unknown) => (detail as { storeAnswer?: StoreAnswer } | null)?.storeAnswer ?? null;

/** The earlier "skip this stop" instruction on the driver's phone is superseded by a decision. */
async function clearSkipNotice(tx: Executor, driverUserId: string | null, outletId: string, at: Date) {
  if (!driverUserId) return;
  await tx
    .update(t.notifications)
    .set({ readAt: at })
    .where(and(eq(t.notifications.recipientUserId, driverUserId), eq(t.notifications.type, "stop.skipped"), like(t.notifications.title, `Skip ${outletId} %`), isNull(t.notifications.readAt)));
  await tx
    .update(t.notifications)
    .set({ readAt: at })
    .where(and(eq(t.notifications.recipientUserId, driverUserId), eq(t.notifications.type, "conflict.waiting"), like(t.notifications.title, `Asking ${outletId} %`), isNull(t.notifications.readAt)));
}

/**
 * DG-02 "Deliver today · ask the store". The window has closed, so a late delivery must be the store's
 * choice, not an assumption: the store gets the decision (DG-03), the driver waits parked.
 */
export async function askStore(opts: { conflictId: string; userId: string }) {
  const [c] = await db().select().from(t.conflicts).where(eq(t.conflicts.id, opts.conflictId));
  if (!c || !c.stopId) throw new Error("Conflict not found");
  if (c.status === "resolved") throw new Error("Already decided");
  if (askOf(c.detail)) throw new Error("The store has already been asked");
  const s = await stopContext(c.stopId);
  if (s.status !== "skipped") throw new Error("Only a stop that was moved to the next run can be offered back to the store");
  const at = await now();
  const eta = Math.round(at.minute + 5); // the driver is parked a few minutes away and has asked to deliver now
  const R = await reference();
  const next = nextOperatingDay(R, s.runDate);
  const ask: StoreAsk = { askedAt: businessDate(at).toISOString(), askedMin: at.minute, eta, by: opts.userId };
  await db().transaction(async (tx) => {
    await tx
      .update(t.conflicts)
      .set({ detail: { ...(c.detail ?? {}), storeAsk: ask } })
      .where(eq(t.conflicts.id, c.id));
    await notify(tx, {
      type: "order.ask",
      title: "Your order can come today after all",
      body: `We moved ${s.orderId} to ${dayLabel(next)} because we had lost contact with the truck. It still has your ${s.units} units and is about 5 minutes away - arriving about ${hhmm(eta)}, ${eta > s.close ? `after your ${hhmm(s.close)} close` : `before your ${hhmm(s.close)} close`}. Accept today, or keep it for ${dayLabel(next)}.`,
      link: `/store/orders/${s.orderId}`,
      severity: "conflict",
      outletId: s.outletId,
    });
    if (s.driverUserId)
      await notify(tx, {
        type: "conflict.waiting",
        title: `Asking ${s.outletId} to accept a late delivery`,
        body: "Stay parked. The store's answer comes here.",
        link: "/drive",
        recipientUserId: s.driverUserId,
      });
    await audit(tx, { actorId: opts.userId, action: "conflict.ask_store", entity: "conflict", entityId: c.id, after: { eta } });
    await emit(tx, "conflict.asked", { conflictId: c.id, stopId: s.id, tripId: s.tripId, outletId: s.outletId });
  });
  return { outletId: s.outletId, eta };
}

/** DG-03: the store accepts the late delivery today, or keeps the next-run slot. The answer settles the conflict. */
export async function storeAnswer(opts: { conflictId: string; outletId: string; userId: string; accept: boolean }) {
  const [c] = await db().select().from(t.conflicts).where(eq(t.conflicts.id, opts.conflictId));
  if (!c || !c.stopId || !askOf(c.detail)) throw new Error("There is no open question for your store");
  if (c.status === "resolved" || answerOf(c.detail)) throw new Error("This has already been decided");
  const s = await stopContext(c.stopId);
  if (s.outletId !== opts.outletId) throw new Error("That order is not for your outlet");
  const at = await now();
  const R = await reference();
  const next = nextOperatingDay(R, s.runDate);
  const answer: StoreAnswer = { accept: opts.accept, at: businessDate(at).toISOString(), atMin: at.minute, by: opts.userId };
  const text = opts.accept
    ? `Deliver today - ${s.outletId} agreed at ${hhmm(at.minute)}; the ${dayLabel(next)} move is cancelled`
    : `Keep ${dayLabel(next)} - ${s.outletId} chose to wait; the goods return to the depot`;
  await db().transaction(async (tx) => {
    if (opts.accept && s.status === "skipped") await restoreStop(tx, s.id);
    await tx
      .update(t.conflicts)
      .set({ status: "resolved", resolution: text, resolvedBy: opts.userId, resolvedAt: businessDate(at), detail: { ...(c.detail ?? {}), storeAnswer: answer } })
      .where(eq(t.conflicts.id, c.id));
    await tx
      .update(t.conflicts)
      .set({ status: "resolved", resolution: text, resolvedBy: opts.userId, resolvedAt: businessDate(at) })
      .where(and(eq(t.conflicts.stopId, s.id), eq(t.conflicts.status, "open")));
    await clearSkipNotice(tx, s.driverUserId, s.outletId, businessDate(at));
    if (s.driverUserId)
      await notify(tx, {
        type: "conflict.resolved",
        title: opts.accept ? `Deliver ${s.outletId} now` : `Keep ${s.outletId} for ${dayLabel(next)}`,
        body: opts.accept
          ? `Store agreed at ${hhmm(at.minute)}. The ${dayLabel(next)} move is cancelled.${askOf(c.detail)!.eta > s.close ? ` The arrival after the ${hhmm(s.close)} window is recorded on the delivery.` : ""}`
          : `The store chose ${dayLabel(next)}. Keep ${s.orderId} (${s.units} units) on board and bring it back to the depot.`,
        link: "/drive",
        severity: opts.accept ? "info" : "conflict",
        recipientUserId: s.driverUserId,
      });
    await notify(tx, {
      type: "conflict.store_answer",
      title: opts.accept ? `${s.outletId} accepted the late delivery` : `${s.outletId} chose to wait for ${dayLabel(next)}`,
      body: opts.accept ? `${s.vehicleId} delivers ${s.orderId} today, about ${hhmm(askOf(c.detail)!.eta)}.` : `${s.orderId} stays on ${dayLabel(next)}'s run with priority.`,
      link: "/dispatch/live/conflicts",
      severity: "info",
      recipientRole: "dispatcher",
    });
    await audit(tx, { actorId: opts.userId, action: "conflict.store_answer", entity: "conflict", entityId: c.id, after: { accept: opts.accept } });
    await emit(tx, "conflict.resolved", { conflictId: c.id, stopId: s.id, tripId: s.tripId, outletId: s.outletId, resolution: opts.accept ? "deliver_today" : "keep_next_run" });
  });
  if (opts.accept) await refreshEtas(s.tripId).catch(() => undefined);
  return { text, accept: opts.accept, next };
}

/** DG-03 data for one order: the open question to the store, if any. */
export async function pendingStoreAsk(orderId: string) {
  const rows = await db()
    .select({ c: t.conflicts, stopId: t.tripStops.id })
    .from(t.conflicts)
    .innerJoin(t.tripStops, eq(t.tripStops.id, t.conflicts.stopId))
    .where(and(eq(t.tripStops.orderId, orderId), eq(t.conflicts.status, "open")));
  const row = rows.find((r) => askOf(r.c.detail) && !answerOf(r.c.detail));
  if (!row) return null;
  const s = await stopContext(row.stopId);
  const R = await reference();
  return { conflictId: row.c.id, ask: askOf(row.c.detail)!, close: s.close, vehicleId: s.vehicleId, units: s.units, next: nextOperatingDay(R, s.runDate) };
}

/** Every notice the store received about one order, oldest first (DG-03 history). */
export async function orderMessages(outletId: string, orderId: string) {
  return db()
    .select({ id: t.notifications.id, type: t.notifications.type, title: t.notifications.title, body: t.notifications.body, at: t.notifications.createdAt })
    .from(t.notifications)
    .where(and(eq(t.notifications.outletId, outletId), eq(t.notifications.link, `/store/orders/${orderId}`)))
    .orderBy(asc(t.notifications.createdAt));
}
