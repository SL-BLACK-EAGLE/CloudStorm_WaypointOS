"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { flagShortfall, resolveFound, setLoaded, signOff } from "@/lib/server/dock";
import { kickRelay } from "@/lib/server/relay";
import { requireUser } from "@/lib/server/session";

type Result = { ok: true; message: string } | { ok: false; error: string };

async function run(fn: () => Promise<string>): Promise<Result> {
  try {
    const message = await fn();
    kickRelay();
    refresh();
    return { ok: true, message };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" };
  }
}

const Ids = z.object({ tripId: z.uuid(), orderId: z.string().min(3).max(20) });

export async function markLoadedAction(form: FormData): Promise<Result> {
  const user = await requireUser(["loader"]);
  const p = Ids.extend({ loaded: z.enum(["1", "0"]) }).safeParse(Object.fromEntries(form));
  if (!p.success) return { ok: false, error: "Invalid request" };
  return run(async () => {
    await setLoaded({ tripId: p.data.tripId, orderId: p.data.orderId, loaded: p.data.loaded === "1", userId: user.id, depotId: user.depotId });
    return p.data.loaded === "1" ? "Loaded" : "Marked not loaded";
  });
}

export async function flagShortfallAction(form: FormData): Promise<Result> {
  const user = await requireUser(["loader"]);
  const p = Ids.extend({
    unitsOnDock: z.coerce.number().int().min(0).max(100000),
    cause: z.enum(["missing", "damaged", "not_cold"]),
    note: z.string().trim().max(300).optional(),
    photoKey: z.string().max(200).optional(),
  }).safeParse(Object.fromEntries(form));
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid request" };
  return run(async () => {
    const r = await flagShortfall({ ...p.data, photoKey: p.data.photoKey || undefined, userId: user.id, depotId: user.depotId });
    return `Flagged ${r.units} short on ${r.outletId}. The dispatcher decides next; sign-off is locked until then.`;
  });
}

export async function unitsFoundAction(form: FormData): Promise<Result> {
  const user = await requireUser(["loader"]);
  const id = z.uuid().safeParse(form.get("shortfallId"));
  if (!id.success) return { ok: false, error: "Invalid request" };
  return run(async () => {
    await resolveFound({ shortfallId: id.data, userId: user.id, depotId: user.depotId });
    return "Units found - the order is complete again.";
  });
}

export async function signOffAction(form: FormData): Promise<Result> {
  const user = await requireUser(["loader"]);
  const p = z.object({ tripId: z.uuid(), reefer: z.enum(["1", "0"]).default("0") }).safeParse(Object.fromEntries(form));
  if (!p.success) return { ok: false, error: "Invalid request" };
  return run(async () => {
    const state = await signOff({ tripId: p.data.tripId, userId: user.id, depotId: user.depotId, reeferConfirmed: p.data.reefer === "1" });
    return state === "RELEASED" ? "Signed off - the vehicle can leave." : `Signed off (${state.replace("RELEASED_", "").replaceAll("_", " ").toLowerCase()}).`;
  });
}
