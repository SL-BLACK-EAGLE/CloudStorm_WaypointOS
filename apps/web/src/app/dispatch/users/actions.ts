"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { ROLE_LABEL, ROLES } from "@/lib/roles";
import { assign, reject, setDisabled } from "@/lib/server/people";
import { kickRelay } from "@/lib/server/relay";
import { requireUser } from "@/lib/server/session";
import type { ActionResult } from "../actions";

const opt = z
  .string()
  .optional()
  .transform((v) => (v ? v : null));

export async function assignAction(form: FormData): Promise<ActionResult> {
  const me = await requireUser(["dispatcher"]);
  const p = z
    .object({ userId: z.uuid(), role: z.enum(ROLES), depotId: opt, outletId: opt, vehicleId: opt })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { ok: false, error: "Choose a role" };
  try {
    const r = await assign({ ...p.data, actorId: me.id });
    kickRelay();
    refresh();
    return { ok: true, message: `${r.name} ${r.approving ? "approved" : "updated"} as ${ROLE_LABEL[p.data.role]}.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save" };
  }
}

export async function rejectAction(form: FormData): Promise<ActionResult> {
  const me = await requireUser(["dispatcher"]);
  const p = z.object({ userId: z.uuid(), body: z.string().trim().min(3).max(300) }).safeParse(Object.fromEntries(form));
  if (!p.success) return { ok: false, error: "Give a short reason" };
  try {
    const name = await reject({ userId: p.data.userId, actorId: me.id, reason: p.data.body });
    refresh();
    return { ok: true, message: `${name}'s request was declined.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not decline" };
  }
}

export async function setDisabledAction(form: FormData): Promise<ActionResult> {
  const me = await requireUser(["dispatcher"]);
  const p = z.object({ userId: z.uuid(), disabled: z.enum(["1", "0"]) }).safeParse(Object.fromEntries(form));
  if (!p.success) return { ok: false, error: "Unknown person" };
  try {
    const name = await setDisabled({ userId: p.data.userId, actorId: me.id, disabled: p.data.disabled === "1" });
    refresh();
    return { ok: true, message: p.data.disabled === "1" ? `${name} can no longer sign in to the app.` : `${name} is active again.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not change" };
  }
}
