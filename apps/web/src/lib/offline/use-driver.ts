"use client";

import { liveQuery } from "dexie";
import { useCallback, useEffect, useMemo, useState } from "react";
import { driverDb, type OutboxRow } from "./db";
import { flush, onServerPack, recordEvent } from "./sync";
import type { PackStop, RunPack } from "./types";

const packKey = (p: RunPack) => `${p.vehicle?.id ?? "none"}|${p.runDate}`;

/**
 * Driver state: the last server pack (kept in IndexedDB) with every queued offline event
 * applied on top, so the screens always show what the driver has done - signal or not.
 */
export function useDriver(serverPack: RunPack | null) {
  const [pack, setPack] = useState<RunPack | null>(serverPack);
  const [outbox, setOutbox] = useState<OutboxRow[]>([]);
  const [online, setOnline] = useState(true);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [previous, setPrevious] = useState<RunPack | null>(null);

  // load the stored pack; prefer whichever is newer
  useEffect(() => {
    let alive = true;
    (async () => {
      const db = driverDb();
      const stored = serverPack ? await db.packs.get(packKey(serverPack)) : (await db.packs.orderBy("savedAt").reverse().first());
      if (!alive) return;
      if (serverPack && (!stored || stored.pack.builtAt <= serverPack.builtAt)) {
        if (stored) setPrevious(stored.pack);
        await db.packs.put({ key: packKey(serverPack), pack: serverPack, savedAt: Date.now() });
        setPack(serverPack);
      } else if (stored) setPack(stored.pack);
    })();
    return () => {
      alive = false;
    };
  }, [serverPack]);

  // fresh packs returned by /api/sync
  useEffect(() => {
    onServerPack(async (p) => {
      const db = driverDb();
      const old = await db.packs.get(packKey(p));
      if (old) setPrevious(old.pack);
      await db.packs.put({ key: packKey(p), pack: p, savedAt: Date.now() });
      setPack(p);
      setLastSync(new Date().toISOString());
    });
  }, []);

  // the outbox, live
  useEffect(() => {
    const sub = liveQuery(() => driverDb().outbox.orderBy("seq").toArray()).subscribe({ next: (rows) => setOutbox(rows as OutboxRow[]) });
    return () => sub.unsubscribe();
  }, []);

  // connectivity
  useEffect(() => {
    const up = () => {
      setOnline(true);
      void flush();
    };
    const down = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    const t = setInterval(() => navigator.onLine && void flush(), 20_000);
    if (navigator.onLine) void flush();
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      clearInterval(t);
    };
  }, []);

  /** pack + optimistic local events */
  const view = useMemo(() => {
    if (!pack) return null;
    const trips = pack.trips.map((tr) => ({ ...tr, stops: tr.stops.map((s) => ({ ...s })) }));
    for (const ev of outbox) {
      if (ev.status === "sent") continue;
      const tr = trips.find((x) => x.tripId === ev.tripId);
      if (!tr) continue;
      if (ev.type === "trip.depart") {
        tr.status = "en_route";
        tr.departedMin = ev.atMin;
      }
      const s: PackStop | undefined = tr.stops.find((x) => x.stopId === ev.stopId);
      if (!s) continue;
      if (ev.type === "stop.arrive") {
        s.status = s.status === "planned" ? "arrived" : s.status;
        s.arrivedMin = ev.atMin;
      }
      if (ev.type === "stop.deliver") {
        s.status = "delivered";
        s.arrivedMin = (ev.payload.arrivedMin as number | undefined) ?? s.arrivedMin ?? ev.atMin;
        s.leftMin = ev.atMin;
      }
      if (ev.type === "stop.exception") {
        s.status = "exception";
        s.leftMin = ev.atMin;
      }
    }
    return { ...pack, trips };
  }, [pack, outbox]);

  /** stops the dispatcher changed since the previous pack (DG-01 "plan changed") */
  const changes = useMemo(() => {
    if (!pack || !previous) return [];
    const before = new Map(previous.trips.flatMap((t) => t.stops.map((s) => [s.stopId, s])));
    return pack.trips.flatMap((t) => t.stops.filter((s) => (before.get(s.stopId)?.version ?? s.version) < s.version || (s.status === "skipped" && before.get(s.stopId)?.status !== "skipped")));
  }, [pack, previous]);

  const record = useCallback(
    (e: Parameters<typeof recordEvent>[1]) => {
      if (!pack) throw new Error("No run on this phone");
      return recordEvent(pack, e);
    },
    [pack],
  );

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/sync", { credentials: "same-origin" });
      if (!r.ok) return false;
      const body = (await r.json()) as { pack: RunPack | null };
      if (body.pack) {
        const db = driverDb();
        const old = await db.packs.get(packKey(body.pack));
        if (old) setPrevious(old.pack);
        await db.packs.put({ key: packKey(body.pack), pack: body.pack, savedAt: Date.now() });
        setPack(body.pack);
        setLastSync(new Date().toISOString());
      }
      return true;
    } catch {
      return false;
    }
  }, []);

  return {
    pack: view,
    outbox,
    online,
    lastSync,
    changes,
    record,
    flush,
    refresh,
    queued: outbox.filter((o) => o.status === "queued").length,
  };
}
