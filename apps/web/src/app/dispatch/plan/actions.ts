"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { moveOrder, type MoveResult } from "@/lib/server/plan-edit";
import { kickRelay } from "@/lib/server/relay";
import { requireUser } from "@/lib/server/session";

const Move = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("trip"),
    planId: z.uuid(),
    orderId: z.string().min(3).max(20),
    vehicleId: z.string().regex(/^VEH\d{3}$/),
    tripNo: z.union([z.coerce.number().int().min(1).max(2), z.literal("new")]),
  }),
  z.object({
    kind: z.literal("defer"),
    planId: z.uuid(),
    orderId: z.string().min(3).max(20),
    justification: z.string().trim().min(5, "Say why, in a few words").max(300),
  }),
]);

/** D-03 drag and drop / "Move to…" - validated again on the server before anything is saved. */
export async function moveOrderAction(form: FormData): Promise<MoveResult> {
  const user = await requireUser(["dispatcher"]);
  const parsed = Move.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid move" };
  const m = parsed.data;
  const result = await moveOrder({
    planId: m.planId,
    orderId: m.orderId,
    userId: user.id,
    to: m.kind === "trip" ? { kind: "trip", vehicleId: m.vehicleId, tripNo: m.tripNo } : { kind: "defer", justification: m.justification },
  });
  if (result.ok) {
    kickRelay();
    refresh();
  }
  return result;
}
