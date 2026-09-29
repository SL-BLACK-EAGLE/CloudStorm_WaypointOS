"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { dayLabel } from "@/lib/format";
import { setVehicleStatus } from "@/lib/server/fleet";
import { kickRelay } from "@/lib/server/relay";
import { requireUser } from "@/lib/server/session";
import type { ActionResult } from "../actions";

export async function vehicleStatusAction(form: FormData): Promise<ActionResult> {
  const user = await requireUser(["dispatcher"]);
  const p = z
    .object({ vehicleId: z.string().regex(/^VEH\d{3}$/), status: z.enum(["available", "in_workshop"]), body: z.string().trim().max(200).optional() })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { ok: false, error: "Unknown vehicle" };
  try {
    const r = await setVehicleStatus({ vehicleId: p.data.vehicleId, status: p.data.status, note: p.data.body, userId: user.id });
    kickRelay();
    refresh();
    return {
      ok: true,
      message: `${r.vehicleId} ${p.data.status === "in_workshop" ? "in the workshop" : "available"} for ${dayLabel(r.planning)}.${r.rerun ? " It had trips on the draft - re-run auto-plan." : ""}`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not change" };
  }
}
