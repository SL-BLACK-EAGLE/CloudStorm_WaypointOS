"use client";

import Dexie, { type EntityTable } from "dexie";
import type { DriverEvent, RunPack } from "./types";

/**
 * On-phone storage (IndexedDB). The pack is the run as last seen from the server; the
 * outbox holds every event recorded since, with its photo/signature blobs, until the
 * server acknowledges it. Nothing here depends on signal.
 */
export interface OutboxRow extends DriverEvent {
  status: "queued" | "sent" | "conflict" | "rejected";
  attempts: number;
  lastError?: string;
  /** local blobs uploaded right before the event is sent */
  blobs?: Array<{ field: "signatureKey" | "photoKey"; kind: "signature" | "pod" | "exception"; blob: Blob }>;
}

export interface PackRow {
  key: string; // vehicleId|runDate
  pack: RunPack;
  savedAt: number;
}

class DriverDB extends Dexie {
  packs!: EntityTable<PackRow, "key">;
  outbox!: EntityTable<OutboxRow, "eventId">;
  meta!: EntityTable<{ key: string; value: unknown }, "key">;

  constructor() {
    super("waypoint-driver");
    this.version(1).stores({
      packs: "key, savedAt",
      outbox: "eventId, seq, status, stopId, tripId",
      meta: "key",
    });
  }
}

let db: DriverDB | null = null;
export function driverDb() {
  db ??= new DriverDB();
  return db;
}

export async function deviceId(): Promise<string> {
  const d = driverDb();
  const row = await d.meta.get("deviceId");
  if (row) return row.value as string;
  const id = `dev-${crypto.randomUUID().slice(0, 13)}`;
  await d.meta.put({ key: "deviceId", value: id });
  return id;
}

export async function nextSeq(): Promise<number> {
  const d = driverDb();
  return d.transaction("rw", d.meta, async () => {
    const row = await d.meta.get("seq");
    const next = ((row?.value as number | undefined) ?? 0) + 1;
    await d.meta.put({ key: "seq", value: next });
    return next;
  });
}
