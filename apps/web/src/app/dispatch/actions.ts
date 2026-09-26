"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { z } from "zod";
import { kickRelay } from "@/lib/server/relay";
import { runAutoPlan } from "@/lib/server/planning";
import { runs } from "@/lib/server/runs";
import { requireUser } from "@/lib/server/session";

const Depot = z.enum(["Peliyagoda", "Kandy"]);

export async function setDepot(form: FormData) {
  await requireUser(["dispatcher"]);
  const depot = form.get("depot") === "Kandy" ? "Kandy" : "Peliyagoda";
  (await cookies()).set("wp-depot", depot, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 90 });
  refresh();
}

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

/** "Run auto-plan" / "Re-run auto-plan" (D-01, D-03). */
export async function autoPlanAction(form: FormData): Promise<ActionResult> {
  const user = await requireUser(["dispatcher"]);
  const depot = Depot.safeParse(form.get("depot"));
  if (!depot.success) return { ok: false, error: "Unknown depot" };
  const { planning } = await runs();
  const { metrics } = await runAutoPlan({ depot: depot.data, runDate: planning, userId: user.id });
  kickRelay();
  refresh();
  return {
    ok: true,
    message: `Planned ${metrics.served} of ${metrics.orders} orders on ${metrics.trips} trips in ${metrics.runtimeMs} ms · ${metrics.deferred} deferred`,
  };
}
