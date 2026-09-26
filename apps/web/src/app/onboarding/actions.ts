"use server";

import { auth } from "@clerk/nextjs/server";
import { eq } from "@waypoint/db/orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ROLES } from "@/lib/roles";
import { db, t } from "@/lib/server/db";
import { audit, notify } from "@/lib/server/events";
import { kickRelay } from "@/lib/server/relay";
import { getAppUser } from "@/lib/server/session";

const Request = z
  .object({
    role: z.enum(ROLES),
    name: z.string().trim().min(2).max(80),
    phone: z.string().trim().max(20).optional().or(z.literal("")),
    depotId: z.enum(["Peliyagoda", "Kandy"]).optional(),
    outletId: z.string().regex(/^OUT\d{3}$/).optional(),
    vehicleId: z.string().regex(/^VEH\d{3}$/).optional(),
    note: z.string().trim().max(400).optional().or(z.literal("")),
  })
  .superRefine((v, ctx) => {
    if (v.role === "store_manager" && !v.outletId) ctx.addIssue({ code: "custom", path: ["outletId"], message: "Choose your outlet" });
    if ((v.role === "loader" || v.role === "driver") && !v.depotId)
      ctx.addIssue({ code: "custom", path: ["depotId"], message: "Choose your depot" });
  });

export type OnboardingState = { error?: string; fieldErrors?: Record<string, string[] | undefined> } | undefined;

export async function requestAccess(_prev: OnboardingState, form: FormData): Promise<OnboardingState> {
  await auth.protect();
  const user = await getAppUser();
  if (!user) redirect("/sign-in");
  if (user.status === "active") redirect("/app");

  const parsed = Request.safeParse({
    role: form.get("role"),
    name: form.get("name"),
    phone: form.get("phone") ?? "",
    depotId: form.get("depotId") || undefined,
    outletId: form.get("outletId") || undefined,
    vehicleId: form.get("vehicleId") || undefined,
    note: form.get("note") ?? "",
  });
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: z.flattenError(parsed.error).fieldErrors };
  const v = parsed.data;

  let depotId: string | null = v.depotId ?? null;
  if (v.role === "store_manager" && v.outletId) {
    const [o] = await db().select({ depotId: t.outlets.depotId }).from(t.outlets).where(eq(t.outlets.id, v.outletId));
    if (!o) return { error: "That outlet does not exist." };
    depotId = o.depotId;
  }

  await db().transaction(async (tx) => {
    await tx
      .update(t.users)
      .set({
        name: v.name,
        phone: v.phone || null,
        requestedRole: v.role,
        status: "pending",
        depotId,
        outletId: v.role === "store_manager" ? (v.outletId ?? null) : null,
        vehicleId: v.role === "driver" ? (v.vehicleId ?? null) : null,
        requestNote: v.note || null,
      })
      .where(eq(t.users.id, user.id));
    await audit(tx, { actorId: user.id, action: "access.requested", entity: "user", entityId: user.id, after: v });
    await notify(tx, {
      type: "access.requested",
      title: "Access request",
      body: `${v.name} asked to join as ${v.role.replace("_", " ")}.`,
      link: "/dispatch/users",
      recipientRole: "dispatcher",
    });
  });
  kickRelay();
  redirect("/pending");
}
