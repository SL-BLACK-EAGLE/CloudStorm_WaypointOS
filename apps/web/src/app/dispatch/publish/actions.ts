"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { publishPlan } from "@/lib/server/plan-decide";
import type { MoveResult } from "@/lib/server/plan-edit";
import { kickRelay } from "@/lib/server/relay";
import { requireUser } from "@/lib/server/session";

export async function publishAction(form: FormData): Promise<MoveResult> {
  const user = await requireUser(["dispatcher"]);
  const planId = z.uuid().safeParse(form.get("planId"));
  if (!planId.success) return { ok: false, error: "Unknown plan" };
  const r = await publishPlan({ planId: planId.data, userId: user.id });
  if (r.ok) {
    kickRelay();
    refresh();
  }
  return r;
}
