"use client";

import { deviceId, driverDb, nextSeq, type OutboxRow } from "./db";
import { clockNow, uuidv7 } from "./clock";
import type { DriverEvent, DriverEventType, RunPack, SyncResponse } from "./types";

/** Records an action on the phone. It is saved first, then sent when there is signal. */
export async function recordEvent(
  pack: RunPack,
  e: { type: DriverEventType; tripId: string; stopId?: string; baseVersion?: number; payload?: Record<string, unknown>; blobs?: OutboxRow["blobs"] },
) {
  const row: OutboxRow = {
    eventId: uuidv7(),
    deviceId: await deviceId(),
    seq: await nextSeq(),
    type: e.type,
    occurredAt: new Date().toISOString(),
    atMin: Math.round(clockNow(pack.clock).minute * 100) / 100,
    tripId: e.tripId,
    stopId: e.stopId,
    baseVersion: e.baseVersion,
    payload: e.payload ?? {},
    status: "queued",
    attempts: 0,
    blobs: e.blobs,
  };
  await driverDb().outbox.put(row);
  void flush();
  return row;
}

let flushing: Promise<void> | null = null;
let backoffMs = 2000;
let timer: ReturnType<typeof setTimeout> | null = null;

async function refreshClerkSession() {
  try {
    const w = window as unknown as { Clerk?: { session?: { getToken: (o?: { skipCache?: boolean }) => Promise<string | null> } } };
    await w.Clerk?.session?.getToken({ skipCache: true });
  } catch {
    /* next attempt */
  }
}

async function uploadBlob(kind: string, id: string, blob: Blob) {
  const f = new FormData();
  f.set("file", new File([blob], `${kind}.${blob.type === "image/png" ? "png" : "jpg"}`, { type: blob.type || "image/jpeg" }));
  f.set("kind", kind);
  f.set("id", id);
  const r = await fetch("/api/uploads", { method: "POST", body: f, credentials: "same-origin" });
  if (r.status === 401) throw Object.assign(new Error("auth"), { auth: true });
  if (!r.ok) throw new Error(`upload ${r.status}`);
  return ((await r.json()) as { key: string }).key;
}

async function doFlush(onPack?: (p: RunPack) => void) {
  const db = driverDb();
  const queued = (await db.outbox.where("status").equals("queued").sortBy("seq")) as OutboxRow[];
  if (!queued.length) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("offline");

  // 1) upload any photos/signatures first (idempotent: the key is derived from the event id)
  for (const row of queued) {
    if (!row.blobs?.length) continue;
    const payload = { ...row.payload };
    for (const b of row.blobs) payload[b.field] = await uploadBlob(b.kind, `${row.eventId}-${b.field === "signatureKey" ? "sig" : "photo"}`, b.blob);
    await db.outbox.update(row.eventId, { payload, blobs: [] });
    row.payload = payload;
  }

  // 2) send the batch
  const events: DriverEvent[] = queued.map(({ status: _s, attempts: _a, lastError: _l, blobs: _b, ...ev }) => ev);
  const send = () =>
    fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ deviceId: events[0]!.deviceId, events }),
    });
  let res = await send();
  if (res.status === 401) {
    await refreshClerkSession();
    res = await send();
  }
  if (res.status === 409) return; // same batch already in flight from another tab
  if (!res.ok) throw new Error(`sync ${res.status}`);
  const body = (await res.json()) as SyncResponse;
  await db.transaction("rw", db.outbox, async () => {
    for (const r of body.results) {
      if (r.outcome === "APPLIED" || r.outcome === "DUPLICATE") await db.outbox.update(r.eventId, { status: "sent" });
      else if (r.outcome === "APPLIED_WITH_CONFLICT") await db.outbox.update(r.eventId, { status: "conflict" });
      else await db.outbox.update(r.eventId, { status: "rejected", lastError: r.message });
    }
  });
  if (body.pack) onPack?.(body.pack);
}

let packListener: ((p: RunPack) => void) | undefined;
export function onServerPack(fn: (p: RunPack) => void) {
  packListener = fn;
}

/** Sends everything queued. Safe to call any time; concurrent calls share one run. */
export function flush(): Promise<void> {
  if (flushing) return flushing;
  flushing = doFlush(packListener)
    .then(() => {
      backoffMs = 2000;
    })
    .catch(async (e: unknown) => {
      if ((e as { auth?: boolean })?.auth) await refreshClerkSession();
      const db = driverDb();
      const queued = await db.outbox.where("status").equals("queued").toArray();
      for (const q of queued) await db.outbox.update(q.eventId, { attempts: q.attempts + 1, lastError: e instanceof Error ? e.message : String(e) });
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void flush(), backoffMs);
      backoffMs = Math.min(backoffMs * 2, 60_000); // exponential backoff while in the dead zone
    })
    .finally(() => {
      flushing = null;
    });
  return flushing;
}
