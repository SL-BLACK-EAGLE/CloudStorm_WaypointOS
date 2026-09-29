"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { dayLabel, hhmm } from "@/lib/format";
import { decideShortfall } from "@/lib/server/dock";
import { closeException, deferStop, markHandled, messageDriver, replyStore, resolveConflict, warnStore, warnTripStores } from "@/lib/server/live";
import { kickRelay } from "@/lib/server/relay";
import { requireUser } from "@/lib/server/session";
import type { ActionResult } from "../actions";
import { currentDepot } from "../depot";

const fail = (e: unknown): ActionResult => ({ ok: false, error: e instanceof Error ? e.message : "That did not go through" });

async function run(fn: (userId: string) => Promise<string>): Promise<ActionResult> {
  const user = await requireUser(["dispatcher"]);
  try {
    const message = await fn(user.id);
    kickRelay();
    refresh();
    return { ok: true, message };
  } catch (e) {
    return fail(e);
  }
}

/** Loader flagged a shortfall: hold the truck until it is complete, or send it and warn the store (L-03 → D-06). */
export async function decideShortfallAction(form: FormData) {
  const p = z.object({ shortfallId: z.uuid(), decision: z.enum(["HOLD", "SEND_AND_WARN"]) }).safeParse(Object.fromEntries(form));
  if (!p.success) return fail(new Error("Unknown shortfall"));
  return run(async (userId) => {
    await decideShortfall({ ...p.data, userId });
    return p.data.decision === "HOLD" ? "Truck held - the loader finds the units, then signs off." : "Truck can leave - the store has been told it will be short.";
  });
}

export async function warnStoreAction(form: FormData) {
  const stopId = z.uuid().safeParse(form.get("stopId"));
  if (!stopId.success) return fail(new Error("Unknown stop"));
  return run(async (userId) => {
    const r = await warnStore({ stopId: stopId.data, userId });
    return `${r.outletId} told to expect the truck around ${hhmm(r.eta)}.`;
  });
}

export async function warnTripStoresAction(form: FormData) {
  const tripId = z.uuid().safeParse(form.get("tripId"));
  if (!tripId.success) return fail(new Error("Unknown trip"));
  const depot = await currentDepot();
  return run(async (userId) => {
    const n = await warnTripStores({ tripId: tripId.data, userId, depot });
    return `New ETAs sent to ${n} store${n === 1 ? "" : "s"}.`;
  });
}

export async function deferStopAction(form: FormData) {
  const p = z.object({ stopId: z.uuid(), reason: z.string().trim().max(300).optional() }).safeParse(Object.fromEntries(form));
  if (!p.success) return fail(new Error("Unknown stop"));
  return run(async (userId) => {
    const r = await deferStop({ stopId: p.data.stopId, userId, reason: p.data.reason || "Projected to arrive after the store's window closes." });
    return `${r.outletId} moved to ${dayLabel(r.next)} with priority. Store and driver told.`;
  });
}

export async function messageDriverAction(form: FormData) {
  const p = z.object({ tripId: z.uuid(), body: z.string().trim().min(2).max(500) }).safeParse(Object.fromEntries(form));
  if (!p.success) return fail(new Error("Write a message first"));
  return run(async (userId) => {
    const r = await messageDriver({ ...p.data, userId });
    return r.hasDriver ? `Sent to ${r.vehicleId}'s driver.` : `Saved on ${r.vehicleId}'s trip - no driver signed in on it yet.`;
  });
}

export async function replyStoreAction(form: FormData) {
  const p = z.object({ orderId: z.string().min(3).max(20), body: z.string().trim().min(2).max(500) }).safeParse(Object.fromEntries(form));
  if (!p.success) return fail(new Error("Write a reply first"));
  return run(async (userId) => {
    await replyStore({ ...p.data, userId });
    return "Reply sent to the store.";
  });
}

export async function closeExceptionAction(form: FormData) {
  const p = z.object({ exceptionId: z.uuid(), outcome: z.enum(["closed", "next_run"]) }).safeParse(Object.fromEntries(form));
  if (!p.success) return fail(new Error("Unknown exception"));
  return run(async (userId) => {
    const r = await closeException({ ...p.data, userId });
    return r.outcome === "next_run" ? `Re-delivery booked first on ${dayLabel(r.next)}. Store told.` : "Closed.";
  });
}

export async function markHandledAction(form: FormData) {
  const p = z.object({ kind: z.enum(["receipt", "message"]), id: z.string().min(3).max(40) }).safeParse(Object.fromEntries(form));
  if (!p.success) return fail(new Error("Unknown item"));
  return run(async (userId) => {
    await markHandled({ ...p.data, userId });
    return "Marked as handled.";
  });
}

export async function resolveConflictAction(form: FormData) {
  const p = z
    .object({ conflictId: z.uuid(), resolution: z.enum(["deliver_today", "keep_next_run", "accept_recorded"]), note: z.string().trim().max(300).optional() })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return fail(new Error("Unknown conflict"));
  return run(async (userId) => {
    const r = await resolveConflict({ ...p.data, userId });
    return `${r.outletId}: ${r.text}. The driver sees it at the next sync.`;
  });
}
