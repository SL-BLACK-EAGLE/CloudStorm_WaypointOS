"use server";

import { and, eq, isNull } from "@waypoint/db/orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { db, t } from "@/lib/server/db";
import { kickRelay } from "@/lib/server/relay";
import { rateLimit } from "@/lib/server/redis";
import { requireUser } from "@/lib/server/session";
import { confirmReceipt, messageDispatcher, placeOrders } from "@/lib/server/store";

const Lines = z.array(z.object({ sku: z.string().min(3).max(20), qty: z.number().int().min(0).max(5000) })).min(1).max(200);

export type PlaceResult =
  | { ok: true; orders: Array<{ id: string; temp: string; runDate: string; units: number; kg: number; m3: number; reason: string }>; placedAt: string }
  | { ok: false; error: string };

/** SM-02 submit. */
export async function placeOrdersAction(input: { lines: Array<{ sku: string; qty: number }>; note?: string }): Promise<PlaceResult> {
  const user = await requireUser(["store_manager"]);
  if (!user.outletId) return { ok: false, error: "No outlet on your account" };
  if (!(await rateLimit("order", user.id, 20, "60 s"))) return { ok: false, error: "Too many orders at once - wait a minute" };
  const lines = Lines.safeParse(input.lines);
  if (!lines.success) return { ok: false, error: "Add at least one item" };
  try {
    const r = await placeOrders({ outletId: user.outletId, userId: user.id, lines: lines.data, note: input.note?.slice(0, 300) });
    kickRelay();
    refresh();
    return { ok: true, orders: r.created, placedAt: r.placedAt.iso };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not place the order" };
  }
}

const Issue = z.object({ kind: z.enum(["damaged", "missing", "wrong_item", "temperature"]), units: z.number().int().min(1), note: z.string().max(300).optional(), photoKey: z.string().max(200).optional() });

/** SM-05 confirm (with or without a problem). */
export async function confirmReceiptAction(input: { orderId: string; unitsReceived: number; issues: Array<z.infer<typeof Issue>>; note?: string }): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const user = await requireUser(["store_manager"]);
  const p = z.object({ orderId: z.string().min(3).max(20), unitsReceived: z.number().int().min(0), issues: z.array(Issue).max(10), note: z.string().max(300).optional() }).safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid receipt" };
  if (p.data.issues.some((i) => i.kind === "damaged" && !i.photoKey)) return { ok: false, error: "Add a photo for damaged goods" };
  try {
    const r = await confirmReceipt({ ...p.data, outletId: user.outletId!, userId: user.id });
    kickRelay();
    refresh();
    return { ok: true, message: r.problem ? "Confirmed with a problem - the dispatcher has it with your photo." : "Receipt confirmed." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not confirm" };
  }
}

export async function messageDispatcherAction(form: FormData): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const user = await requireUser(["store_manager"]);
  const p = z.object({ orderId: z.string().min(3).max(20), body: z.string().trim().min(3).max(1000) }).safeParse(Object.fromEntries(form));
  if (!p.success) return { ok: false, error: "Write a message first" };
  await messageDispatcher({ ...p.data, outletId: user.outletId!, userId: user.id });
  kickRelay();
  return { ok: true, message: "Sent to the dispatcher." };
}

/** SM-04 "Got it": marks the deferral notice as read. */
export async function ackNoticeAction(form: FormData): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const user = await requireUser(["store_manager"]);
  const orderId = String(form.get("orderId") ?? "");
  await db()
    .update(t.notifications)
    .set({ readAt: new Date() })
    .where(and(eq(t.notifications.outletId, user.outletId!), eq(t.notifications.link, `/store/orders/${orderId}`), isNull(t.notifications.readAt)));
  refresh();
  return { ok: true, message: "Noted." };
}
