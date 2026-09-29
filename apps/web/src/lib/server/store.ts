import "server-only";
import { and, asc, desc, eq, gte, inArray, like, lte } from "@waypoint/db/orm";
import { intake, nextOperatingDay, previousOperatingDay } from "@waypoint/planner";
import { dayLabel, hhmm } from "@/lib/format";
import { businessDate, now } from "./clock";
import { db, t } from "./db";
import { audit, emit, notify } from "./events";
import { reference } from "./reference";

export async function outletInfo(outletId: string) {
  const [o] = await db().select().from(t.outlets).where(eq(t.outlets.id, outletId));
  return o ?? null;
}

/** Orders of one outlet between two run dates, with where each one is in its journey. */
export async function storeOrders(outletId: string, from: string, to: string) {
  const orders = await db()
    .select()
    .from(t.orders)
    .where(and(eq(t.orders.outletId, outletId), gte(t.orders.runDate, from), lte(t.orders.runDate, to)))
    .orderBy(desc(t.orders.runDate), asc(t.orders.temp), asc(t.orders.id));
  if (!orders.length) return [];
  const ids = orders.map((o) => o.id);
  const [stops, defs, receipts, pods] = await Promise.all([
    db()
      .select({
        orderId: t.tripStops.orderId,
        stopId: t.tripStops.id,
        seq: t.tripStops.seq,
        plannedArrive: t.tripStops.plannedArrive,
        etaMin: t.tripStops.etaMin,
        lateRisk: t.tripStops.lateRisk,
        status: t.tripStops.status,
        arrivedMin: t.tripStops.arrivedMin,
        leftMin: t.tripStops.leftMin,
        tripId: t.trips.id,
        tripCode: t.trips.code,
        vehicleId: t.trips.vehicleId,
        tripStatus: t.trips.status,
        departedMin: t.trips.departedMin,
        departureMin: t.trips.departureMin,
        planStatus: t.plans.status,
        publishedAt: t.plans.publishedAt,
      })
      .from(t.tripStops)
      .innerJoin(t.trips, eq(t.trips.id, t.tripStops.tripId))
      .innerJoin(t.plans, eq(t.plans.id, t.trips.planId))
      .where(and(inArray(t.tripStops.orderId, ids), eq(t.plans.status, "published"))),
    db()
      .select({
        orderId: t.deferrals.orderId,
        kind: t.deferrals.kind,
        reasonCode: t.deferrals.reasonCode,
        explanation: t.deferrals.explanation,
        newRunDate: t.deferrals.newRunDate,
        planStatus: t.plans.status,
        publishedAt: t.plans.publishedAt,
      })
      .from(t.deferrals)
      .innerJoin(t.plans, eq(t.plans.id, t.deferrals.planId))
      .where(and(inArray(t.deferrals.orderId, ids), eq(t.plans.status, "published"))),
    db().select().from(t.receipts).where(inArray(t.receipts.orderId, ids)),
    db()
      .select({ orderId: t.tripStops.orderId, pod: t.pods })
      .from(t.pods)
      .innerJoin(t.tripStops, eq(t.tripStops.id, t.pods.stopId))
      .where(inArray(t.tripStops.orderId, ids)),
  ]);
  const signoffs = stops.length
    ? await db()
        .select()
        .from(t.dockSignoffs)
        .where(
          inArray(
            t.dockSignoffs.tripId,
            stops.map((s) => s.tripId),
          ),
        )
    : [];
  return orders.map((o) => {
    const stop = stops.find((s) => s.orderId === o.id) ?? null;
    return {
      ...o,
      stop,
      stopsBefore: stop ? stop.seq - 1 : null,
      deferral: defs.find((d) => d.orderId === o.id) ?? null,
      receipt: receipts.find((r) => r.orderId === o.id) ?? null,
      pod: pods.find((p) => p.orderId === o.id)?.pod ?? null,
      signedOff: stop ? signoffs.some((s) => s.tripId === stop.tripId) : false,
    };
  });
}
export type StoreOrder = Awaited<ReturnType<typeof storeOrders>>[number];

/** SM-03 stages: placed -> confirmed -> planned -> loaded -> en route -> delivered / deferred. */
export function stageOf(o: StoreOrder): "placed" | "confirmed" | "planned" | "loaded" | "en_route" | "delivered" | "deferred" | "exception" {
  if (o.status === "deferred" || (o.deferral && !o.stop)) return "deferred";
  if (o.status === "exception") return "exception";
  if (o.status === "delivered" || o.stop?.status === "delivered") return "delivered";
  if (o.status === "en_route" || o.stop?.tripStatus === "en_route") return "en_route";
  if (o.signedOff || o.status === "loading") return "loaded";
  if (o.stop) return "planned";
  return "confirmed";
}

/** The order date a store is ordering for right now (the next operating day). */
export async function orderingRun() {
  const c = await now();
  const R = await reference();
  const requested = nextOperatingDay(R, c.date);
  const res = intake(R, "OUT001", "ambient", 1, 0.01, requested, c.date, `${hhmm(c.minute)}`);
  return {
    clock: c,
    requested,
    runDate: res.runDate ?? requested,
    afterCutoff: res.reason.includes("AFTER_CUTOFF"),
  };
}

export interface LineInput {
  sku: string;
  qty: number;
}

/**
 * SM-02 submit. Dry and chilled lines become separate orders (a chilled order needs a reefer).
 * The planner's F1 intake decides the run: after 16:00 or on a closed day it moves on.
 */
export async function placeOrders(opts: { outletId: string; userId: string; lines: LineInput[]; note?: string }) {
  const outlet = await outletInfo(opts.outletId);
  if (!outlet) throw new Error("Unknown outlet");
  const skus = [...new Set(opts.lines.filter((l) => l.qty > 0).map((l) => l.sku))];
  if (!skus.length) throw new Error("Add at least one item");
  const products = await db().select().from(t.products).where(inArray(t.products.sku, skus));
  const bySku = new Map(products.map((p) => [p.sku, p]));
  for (const l of opts.lines) {
    const p = bySku.get(l.sku);
    if (!p) throw new Error(`Unknown item ${l.sku}`);
    if (p.brand !== outlet.brand) throw new Error(`${p.name} is not a ${outlet.brand} item`);
  }
  const groups = new Map<"chilled" | "ambient", LineInput[]>();
  for (const l of opts.lines.filter((x) => x.qty > 0)) {
    const temp = bySku.get(l.sku)!.temp;
    groups.set(temp, [...(groups.get(temp) ?? []), l]);
  }
  const { clock, requested } = await orderingRun();
  const R = await reference();
  const created: Array<{
    id: string;
    temp: string;
    runDate: string;
    units: number;
    kg: number;
    m3: number;
    reason: string;
  }> = [];

  await db().transaction(async (tx) => {
    const [last] = await tx.select({ id: t.orders.id }).from(t.orders).where(like(t.orders.id, "ORD01%")).orderBy(desc(t.orders.id)).limit(1);
    let seq = last ? Number(last.id.slice(3)) : 100000;
    for (const [temp, lines] of groups) {
      const kg = lines.reduce((s, l) => s + bySku.get(l.sku)!.unitKg * l.qty, 0);
      const m3 = lines.reduce((s, l) => s + bySku.get(l.sku)!.unitM3 * l.qty, 0);
      const units = lines.reduce((s, l) => s + l.qty, 0);
      const res = intake(R, outlet.id, temp, kg, m3, requested, clock.date, hhmm(clock.minute));
      if (res.status === "REJECT") {
        throw new Error(
          res.reason === "ONLY_FRESH_CAN_BE_CHILLED"
            ? "Only Fresh outlets order chilled goods"
            : "This order is bigger than any vehicle that can reach you - split it into two",
        );
      }
      const runDate = res.runDate!;
      // fairness counters the planner uses (P19): skipped on the previous run, days since last served
      const prev = previousOperatingDay(R, runDate);
      const [skipped] = await tx
        .select({ id: t.orders.id })
        .from(t.orders)
        .where(and(eq(t.orders.outletId, outlet.id), eq(t.orders.requestedDate, prev), inArray(t.orders.status, ["deferred", "cancelled"])))
        .limit(1);
      const [served] = await tx
        .select({ runDate: t.orders.runDate })
        .from(t.orders)
        .where(and(eq(t.orders.outletId, outlet.id), eq(t.orders.status, "delivered")))
        .orderBy(desc(t.orders.runDate))
        .limit(1);
      const days = served ? Math.max(1, Math.round((Date.parse(runDate) - Date.parse(served.runDate)) / 86_400_000)) : 7;
      const id = `ORD${String(++seq).padStart(7, "0")}`;
      await tx.insert(t.orders).values({
        id,
        outletId: outlet.id,
        brand: outlet.brand,
        depotId: outlet.depotId,
        temp,
        requestedDate: requested,
        runDate,
        status: "confirmed",
        intakeReason: res.reason,
        units,
        weightKg: Math.round(kg * 10) / 10,
        volumeM3: Math.round(m3 * 1000) / 1000,
        deferredYesterday: skipped ? 1 : 0,
        daysSinceLastServed: days,
        source: "app",
        note: opts.note ?? null,
        createdBy: opts.userId,
        receivedAt: businessDate(clock),
      });
      await tx.insert(t.orderLines).values(
        lines.map((l) => {
          const p = bySku.get(l.sku)!;
          return {
            orderId: id,
            sku: l.sku,
            qty: l.qty,
            kg: Math.round(p.unitKg * l.qty * 1000) / 1000,
            m3: Math.round(p.unitM3 * l.qty * 100000) / 100000,
          };
        }),
      );
      created.push({ id, temp, runDate, units, kg, m3, reason: res.reason });
      await emit(tx, "order.placed", {
        id,
        outletId: outlet.id,
        depot: outlet.depotId,
        runDate,
        temp,
      });
    }
    await audit(tx, {
      actorId: opts.userId,
      action: "order.place",
      entity: "outlet",
      entityId: outlet.id,
      after: created,
    });
  });
  return { created, placedAt: clock, requested };
}

/** SM-05: the store's count against the driver's proof of delivery; problems reach the dispatcher at once. */
export async function confirmReceipt(opts: {
  orderId: string;
  outletId: string;
  userId: string;
  unitsReceived: number;
  issues: Array<{
    kind: "damaged" | "missing" | "wrong_item" | "temperature";
    units: number;
    note?: string;
    photoKey?: string;
  }>;
  note?: string;
}) {
  const [o] = await db().select().from(t.orders).where(eq(t.orders.id, opts.orderId));
  if (!o || o.outletId !== opts.outletId) throw new Error("That order is not for your outlet");
  if (o.status !== "delivered" && o.status !== "exception") throw new Error("Confirm receipt once the driver has delivered");
  const [already] = await db().select().from(t.receipts).where(eq(t.receipts.orderId, o.id));
  if (already) throw new Error("Receipt already confirmed");
  if (opts.unitsReceived > o.units) throw new Error(`The order has ${o.units} units`);
  const missing = opts.issues.filter((i) => i.kind === "missing").reduce((n, i) => n + i.units, 0);
  if (missing !== o.units - opts.unitsReceived) throw new Error(`${o.units - opts.unitsReceived} units are missing by your count - report them as missing`);
  const problem = opts.issues.length > 0 || opts.unitsReceived < o.units;
  await db().transaction(async (tx) => {
    await tx.insert(t.receipts).values({
      confirmedAt: businessDate(await now()),
      orderId: o.id,
      status: problem ? "problem" : "confirmed",
      unitsReceived: opts.unitsReceived,
      note: opts.note,
      confirmedBy: opts.userId,
    });
    if (opts.issues.length)
      await tx.insert(t.receiptIssues).values(
        opts.issues.map((i) => ({
          orderId: o.id,
          kind: i.kind,
          units: i.units,
          note: i.note,
          photoKey: i.photoKey,
        })),
      );
    if (problem) {
      await notify(tx, {
        type: "receipt.problem",
        title: `${o.outletId} reports a problem with ${o.id}`,
        body: `${opts.unitsReceived} of ${o.units} units received${opts.issues.length ? ` · ${opts.issues.map((i) => `${i.units} ${i.kind.replace("_", " ")}`).join(", ")}` : ""}.`,
        link: "/dispatch/live",
        severity: "exception",
        recipientRole: "dispatcher",
      });
    }
    await audit(tx, {
      actorId: opts.userId,
      action: "receipt.confirm",
      entity: "order",
      entityId: o.id,
      after: { unitsReceived: opts.unitsReceived, issues: opts.issues.length },
    });
    await emit(tx, "receipt.confirmed", { orderId: o.id, problem });
  });
  return { problem };
}

/** "Message the dispatcher" (SM-04 / SM-05). */
export async function messageDispatcher(opts: { orderId: string; outletId: string; userId: string; body: string }) {
  await db().transaction(async (tx) => {
    await tx.insert(t.messages).values({
      threadType: "order",
      threadId: opts.orderId,
      authorId: opts.userId,
      body: opts.body,
      createdAt: businessDate(await now()),
    });
    await notify(tx, {
      type: "message",
      title: `Message from ${opts.outletId} about ${opts.orderId}`,
      body: opts.body.slice(0, 280),
      link: "/dispatch/live",
      recipientRole: "dispatcher",
    });
  });
}

export function runLabel(date: string) {
  return dayLabel(date);
}
