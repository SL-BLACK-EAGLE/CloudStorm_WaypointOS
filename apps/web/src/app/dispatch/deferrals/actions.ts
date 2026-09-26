"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { moveOrder, type MoveResult } from "@/lib/server/plan-edit";
import { keepDeferred, swapDeferral } from "@/lib/server/plan-decide";
import { kickRelay } from "@/lib/server/relay";
import { requireUser } from "@/lib/server/session";

const Base = z.object({ planId: z.uuid(), orderId: z.string().min(3).max(20) });
const Decide = z.discriminatedUnion("decision", [
  Base.extend({ decision: z.literal("keep"), reason: z.string().trim().min(5, "Give a reason to keep it deferred").max(300) }),
  Base.extend({ decision: z.literal("swap"), outOrderId: z.string().min(3).max(20), reason: z.string().trim().max(300).default("") }),
  Base.extend({
    decision: z.literal("slot"),
    vehicleId: z.string().regex(/^VEH\d{3}$/),
    tripNo: z.union([z.coerce.number().int().min(1).max(2), z.literal("new")]),
  }),
]);

/** D-04 row actions: keep deferred (with reason), serve instead of the order it lost to, or serve in a free legal slot. */
export async function decideDeferralAction(form: FormData): Promise<MoveResult> {
  const user = await requireUser(["dispatcher"]);
  const p = Decide.safeParse(Object.fromEntries(form));
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid decision" };
  const d = p.data;
  const r =
    d.decision === "keep"
      ? await keepDeferred({ planId: d.planId, orderId: d.orderId, reason: d.reason, userId: user.id })
      : d.decision === "swap"
        ? await swapDeferral({ planId: d.planId, orderId: d.orderId, outOrderId: d.outOrderId, userId: user.id, reason: d.reason || "higher operational priority" })
        : await moveOrder({ planId: d.planId, orderId: d.orderId, userId: user.id, to: { kind: "trip", vehicleId: d.vehicleId, tripNo: d.tripNo } });
  if (r.ok) {
    kickRelay();
    refresh();
  }
  return r;
}
