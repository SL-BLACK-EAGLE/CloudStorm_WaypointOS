import { z } from "zod";
import { buildPack, applyEvents } from "@/lib/server/drive";
import { claim, rateLimit, release } from "@/lib/server/redis";
import { kickRelay } from "@/lib/server/relay";
import { userForApi } from "@/lib/server/session";
import type { SyncResponse } from "@/lib/offline/types";

const Event = z.object({
  eventId: z.uuid(),
  deviceId: z.string().min(3).max(40),
  seq: z.number().int().nonnegative(),
  type: z.enum(["trip.depart", "stop.arrive", "stop.deliver", "stop.exception"]),
  occurredAt: z.iso.datetime(),
  atMin: z.number().min(0).max(48 * 60),
  tripId: z.uuid(),
  stopId: z.uuid().optional(),
  baseVersion: z.number().int().positive().optional(),
  payload: z.record(z.string(), z.unknown()),
});
const Batch = z.object({ deviceId: z.string().min(3).max(40), events: z.array(Event).max(200) });

/**
 * POST /api/sync - the driver's offline outbox, replayed on reconnect.
 * Idempotent per event (sync_events primary key) and per batch (Redis claim), rate limited
 * per device, and it always answers with a fresh pack so the phone sees the plan as it is now.
 */
export async function POST(req: Request) {
  const user = await userForApi(["driver"]);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Batch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Bad batch" }, { status: 400 });
  const { deviceId, events } = parsed.data;
  if (!(await rateLimit("sync", `${user.id}:${deviceId}`, 30, "60 s"))) return Response.json({ error: "Too many sync attempts" }, { status: 429 });

  const batchKey = `sync:${deviceId}:${events.map((e) => e.eventId).join(",").slice(0, 400)}`;
  if (events.length && !(await claim(batchKey, 60))) return Response.json({ error: "This batch is already being processed" }, { status: 409 });
  try {
    const results = events.length ? await applyEvents(user, deviceId, events) : [];
    if (events.length) kickRelay();
    const body: SyncResponse = { results, pack: await buildPack(user) };
    return Response.json(body);
  } finally {
    await release(batchKey);
  }
}

/** GET /api/sync - fresh pack only (used when the app opens with signal). */
export async function GET() {
  const user = await userForApi(["driver"]);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body: SyncResponse = { results: [], pack: await buildPack(user) };
  return Response.json(body);
}
