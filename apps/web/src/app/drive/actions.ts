"use server";

import { eq } from "@waypoint/db/orm";
import { z } from "zod";
import { db, t } from "@/lib/server/db";
import { emit, notify } from "@/lib/server/events";
import { kickRelay } from "@/lib/server/relay";
import { requireUser } from "@/lib/server/session";

/** DG-01 "Tell dispatcher: I can deliver now" - opens a conflict the dispatcher resolves in DG-02. */
export async function canDeliverAction(form: FormData): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const user = await requireUser(["driver"]);
  const stopId = z.uuid().safeParse(form.get("stopId"));
  if (!stopId.success) return { ok: false, error: "Unknown stop" };
  const [s] = await db()
    .select({ id: t.tripStops.id, status: t.tripStops.status, vehicleId: t.trips.vehicleId, outletId: t.orders.outletId, orderId: t.tripStops.orderId })
    .from(t.tripStops)
    .innerJoin(t.trips, eq(t.trips.id, t.tripStops.tripId))
    .innerJoin(t.orders, eq(t.orders.id, t.tripStops.orderId))
    .where(eq(t.tripStops.id, stopId.data));
  if (!s || s.vehicleId !== user.vehicleId) return { ok: false, error: "That stop is not on your vehicle" };
  await db().transaction(async (tx) => {
    await tx.insert(t.conflicts).values({
      stopId: s.id,
      kind: "DRIVER_CAN_DELIVER",
      detail: { outletId: s.outletId, orderId: s.orderId, vehicleId: s.vehicleId, driver: user.name },
    });
    await notify(tx, {
      type: "sync.conflict",
      title: `${s.vehicleId} can still deliver ${s.outletId}`,
      body: `${user.name} has the goods on board and asks to deliver today instead of the next run. Decide in reconciliation.`,
      link: "/dispatch/live/conflicts",
      severity: "conflict",
      recipientRole: "dispatcher",
    });
    await emit(tx, "sync.conflict", { stopId: s.id, kind: "DRIVER_CAN_DELIVER" });
  });
  kickRelay();
  return { ok: true, message: "Sent. Stay parked - the dispatcher's answer appears here." };
}
