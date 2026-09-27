"use server";

import { and, eq } from "@waypoint/db/orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { writeClock } from "@/lib/server/clock";
import { db, t } from "@/lib/server/db";
import { audit } from "@/lib/server/events";
import { requireUser, syncClerkMetadata } from "@/lib/server/session";

type Result = { ok: true; message: string } | { ok: false; error: string };

/** Judge panel: set the business clock (the seeded operation is 22-23 Dec 2025). */
export async function setClockAction(form: FormData): Promise<Result> {
  const user = await requireUser();
  const p = z
    .object({
      at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/).optional(),
      running: z.enum(["1", "0"]).optional(),
      speed: z.coerce.number().min(1).max(600).optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { ok: false, error: "Invalid time" };
  const at = p.data.at ? (p.data.at.length === 16 ? `${p.data.at}:00` : p.data.at) : undefined;
  const c = await writeClock({ at, running: p.data.running ? p.data.running === "1" : undefined, speed: p.data.speed });
  await db().transaction((tx) => audit(tx, { actorId: user.id, action: "demo.clock", entity: "clock", entityId: "clock", after: c }));
  refresh();
  return { ok: true, message: `Business clock: ${c.iso.replace("T", " ").slice(0, 16)}${c.running ? ` · running ×${c.speed}` : " · paused"}` };
}

/** Judge panel: let the demo driver take over any vehicle that has trips in the published plan. */
export async function driveVehicleAction(form: FormData): Promise<Result> {
  const user = await requireUser();
  const vehicleId = z.string().regex(/^VEH\d{3}$/).safeParse(form.get("vehicleId"));
  if (!vehicleId.success) return { ok: false, error: "Choose a vehicle" };
  const [v] = await db().select().from(t.vehicles).where(eq(t.vehicles.id, vehicleId.data));
  if (!v) return { ok: false, error: "Unknown vehicle" };
  // a driver switches themself; anyone else switches the seeded demo driver
  const [target] =
    user.role === "driver"
      ? [user]
      : await db().select().from(t.users).where(and(eq(t.users.role, "driver"), eq(t.users.email, "driver+clerk_test@waypoint-demo.lk")));
  if (!target) return { ok: false, error: "No demo driver account" };
  const [updated] = await db().update(t.users).set({ vehicleId: v.id, depotId: v.depotId }).where(eq(t.users.id, target.id)).returning();
  // published trips of that vehicle now belong to this driver
  await db().update(t.trips).set({ driverUserId: target.id }).where(eq(t.trips.vehicleId, v.id));
  if (updated) await syncClerkMetadata(updated).catch(() => undefined);
  refresh();
  return { ok: true, message: `${target.name} now drives ${v.id} (${v.temp} ${v.type}, ${v.depotId}).` };
}

/** Judge panel: point the demo store manager at another outlet (e.g. one the demo driver just delivered to). */
export async function storeOutletAction(form: FormData): Promise<Result> {
  const user = await requireUser();
  const outletId = z.string().regex(/^OUT\d{3}$/).safeParse(form.get("outletId"));
  if (!outletId.success) return { ok: false, error: "Choose an outlet" };
  const [o] = await db().select().from(t.outlets).where(eq(t.outlets.id, outletId.data));
  if (!o) return { ok: false, error: "Unknown outlet" };
  const [target] =
    user.role === "store_manager"
      ? [user]
      : await db().select().from(t.users).where(and(eq(t.users.role, "store_manager"), eq(t.users.email, "store+clerk_test@waypoint-demo.lk")));
  if (!target) return { ok: false, error: "No demo store account" };
  const [updated] = await db().update(t.users).set({ outletId: o.id, depotId: o.depotId }).where(eq(t.users.id, target.id)).returning();
  if (updated) await syncClerkMetadata(updated).catch(() => undefined);
  refresh();
  return { ok: true, message: `${target.name} now manages ${o.id} (${o.brand}, ${o.district}).` };
}

/** Judge panel: restore the 22-23 Dec demo day (orders, fleet status, clock, demo users). */
export async function resetDemoAction(): Promise<Result> {
  const user = await requireUser();
  try {
    const seed = await import("@waypoint/db/seed");
    seed.dataDir();
    await seed.seedOperations(db());
    await seed.seedUsers(db());
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.split("\n")[0]! : "Reset failed" };
  }
  await db().transaction((tx) => audit(tx, { actorId: user.id, action: "demo.reset", entity: "demo", entityId: "all" })).catch(() => undefined);
  refresh();
  return { ok: true, message: "Demo reset: Mon 22 Dec 14:30, orders open, nothing planned yet." };
}
