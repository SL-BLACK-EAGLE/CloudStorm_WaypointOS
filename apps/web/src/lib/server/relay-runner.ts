import "server-only";
import { ConvexHttpClient } from "convex/browser";
import { asc, inArray, isNull, sql } from "@waypoint/db/orm";
import { api } from "../../../convex/_generated/api";
import { db, t } from "./db";
import { claim, release } from "./redis";

const BATCH = 100;

/** Which realtime channels an outbox event touches (see convex/schema.ts). */
export function channelsFor(topic: string, p: Record<string, unknown>): string[] {
  const out = new Set<string>(["ops"]);
  const str = (k: string) => (typeof p[k] === "string" && p[k] ? (p[k] as string) : null);
  const depot = str("depot") ?? str("depotId");
  if (depot) out.add(`depot:${depot}`);
  if (str("tripId")) out.add(`trip:${str("tripId")}`);
  if (str("outletId")) out.add(`outlet:${str("outletId")}`);
  if (str("recipientUserId")) out.add(`user:${str("recipientUserId")}`);
  if (str("recipientRole")) out.add(`role:${str("recipientRole")}`);
  if (topic.startsWith("order.") || topic.startsWith("plan.")) out.add("orders");
  return [...out];
}

/**
 * Delivers committed outbox rows to Convex, oldest first. One runner at a time (Redis lock);
 * a failed batch stays pending with its error and is retried by the next kick or the scheduled sweep.
 */
export async function triggerRelay(): Promise<{ relayed: number; skipped?: string }> {
  // inside docker the server reaches Convex by service name; browsers use NEXT_PUBLIC_CONVEX_URL
  const url = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  const secret = process.env.CONVEX_SERVER_SECRET;
  if (!url || !secret) return { relayed: 0, skipped: "convex not configured" };
  if (!(await claim("relay", 30))) return { relayed: 0, skipped: "another relay is running" };
  const client = new ConvexHttpClient(url);
  let relayed = 0;
  try {
    for (let round = 0; round < 20; round++) {
      const rows = await db().select().from(t.outbox).where(isNull(t.outbox.relayedAt)).orderBy(asc(t.outbox.id)).limit(BATCH);
      if (!rows.length) break;
      const ids = rows.map((r) => r.id);
      try {
        await client.mutation(api.signals.relay, {
          secret,
          items: rows.map((r) => ({ outboxId: r.id, topic: r.topic, channels: channelsFor(r.topic, r.payload) })),
        });
        await db().update(t.outbox).set({ relayedAt: new Date() }).where(inArray(t.outbox.id, ids));
        relayed += rows.length;
      } catch (e) {
        await db()
          .update(t.outbox)
          .set({ attempts: sql`${t.outbox.attempts} + 1`, lastError: e instanceof Error ? e.message.slice(0, 500) : "relay failed" })
          .where(inArray(t.outbox.id, ids));
        throw e;
      }
      if (rows.length < BATCH) break;
    }
  } finally {
    await release("relay");
  }
  return { relayed };
}
