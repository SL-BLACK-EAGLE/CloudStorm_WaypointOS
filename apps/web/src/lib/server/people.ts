import "server-only";
import { asc, desc, eq } from "@waypoint/db/orm";
import { ROLE_HOME, ROLE_LABEL, type Role } from "@/lib/roles";
import { db, t } from "./db";
import { audit, notify } from "./events";
import { syncClerkMetadata } from "./session";

export async function people() {
  const [users, outlets, vehicles] = await Promise.all([
    db().select().from(t.users).orderBy(desc(t.users.createdAt)),
    db().select({ id: t.outlets.id, name: t.outlets.name, district: t.outlets.district, brand: t.outlets.brand, depotId: t.outlets.depotId }).from(t.outlets).orderBy(asc(t.outlets.id)),
    db().select({ id: t.vehicles.id, type: t.vehicles.type, temp: t.vehicles.temp, depotId: t.vehicles.depotId }).from(t.vehicles).orderBy(asc(t.vehicles.id)),
  ]);
  return { users, outlets, vehicles };
}

export interface Assignment {
  userId: string;
  role: Role;
  depotId?: string | null;
  outletId?: string | null;
  vehicleId?: string | null;
}

/** Validates a role + scope: store managers need an outlet (the depot follows), loaders and drivers need a depot. */
async function scopeFor(a: Assignment) {
  let depotId = a.depotId ?? null;
  const outletId = a.role === "store_manager" ? (a.outletId ?? null) : null;
  const vehicleId = a.role === "driver" ? (a.vehicleId ?? null) : null;
  if (a.role === "store_manager") {
    if (!outletId) throw new Error("Choose the outlet this store manager runs");
    const [o] = await db().select({ depotId: t.outlets.depotId }).from(t.outlets).where(eq(t.outlets.id, outletId));
    if (!o) throw new Error("Unknown outlet");
    depotId = o.depotId;
  }
  if ((a.role === "loader" || a.role === "driver") && !depotId) throw new Error("Choose the depot");
  if (vehicleId) {
    const [v] = await db().select({ depotId: t.vehicles.depotId }).from(t.vehicles).where(eq(t.vehicles.id, vehicleId));
    if (!v) throw new Error("Unknown vehicle");
    if (depotId && v.depotId !== depotId) throw new Error(`${vehicleId} belongs to ${v.depotId}, not ${depotId}`);
    depotId = v.depotId;
  }
  return { depotId, outletId, vehicleId };
}

/** Approves an access request (or changes an active person's role and scope). */
export async function assign(a: Assignment & { actorId: string }) {
  const [before] = await db().select().from(t.users).where(eq(t.users.id, a.userId));
  if (!before) throw new Error("Unknown person");
  if (before.id === a.actorId && a.role !== "dispatcher") throw new Error("You cannot take the dispatcher role away from yourself");
  const scope = await scopeFor(a);
  const approving = before.status !== "active";
  const [after] = await db().transaction(async (tx) => {
    const rows = await tx
      .update(t.users)
      .set({ role: a.role, status: "active", ...scope, ...(approving ? { approvedBy: a.actorId, approvedAt: new Date() } : {}) })
      .where(eq(t.users.id, a.userId))
      .returning();
    await notify(tx, {
      type: approving ? "access.approved" : "access.changed",
      title: approving ? `Access approved · ${ROLE_LABEL[a.role]}` : `Your access changed · ${ROLE_LABEL[a.role]}`,
      body: approving ? "You can start now. Sign in again if the app still shows the waiting screen." : "Your role or scope was updated by the dispatcher.",
      link: ROLE_HOME[a.role],
      recipientUserId: a.userId,
    });
    await audit(tx, {
      actorId: a.actorId,
      action: approving ? "user.approve" : "user.assign",
      entity: "user",
      entityId: a.userId,
      before: { role: before.role, status: before.status, depotId: before.depotId, outletId: before.outletId, vehicleId: before.vehicleId },
      after: { role: a.role, ...scope },
    });
    return rows;
  });
  if (after) await syncClerkMetadata(after).catch(() => undefined);
  return { name: before.name, approving };
}

export async function reject(opts: { userId: string; actorId: string; reason: string }) {
  const [u] = await db().select().from(t.users).where(eq(t.users.id, opts.userId));
  if (!u) throw new Error("Unknown person");
  if (u.status === "active") throw new Error("Disable an active account instead of rejecting it");
  const [after] = await db().transaction(async (tx) => {
    const rows = await tx.update(t.users).set({ status: "rejected" }).where(eq(t.users.id, u.id)).returning();
    await notify(tx, { type: "access.rejected", title: "Access request not approved", body: opts.reason, recipientUserId: u.id });
    await audit(tx, { actorId: opts.actorId, action: "user.reject", entity: "user", entityId: u.id, justification: opts.reason });
    return rows;
  });
  if (after) await syncClerkMetadata(after).catch(() => undefined);
  return u.name;
}

export async function setDisabled(opts: { userId: string; actorId: string; disabled: boolean }) {
  if (opts.userId === opts.actorId) throw new Error("You cannot disable your own account");
  const [u] = await db().select().from(t.users).where(eq(t.users.id, opts.userId));
  if (!u) throw new Error("Unknown person");
  if (!opts.disabled && !u.role) throw new Error("Approve a role first");
  const [after] = await db().transaction(async (tx) => {
    const rows = await tx
      .update(t.users)
      .set({ status: opts.disabled ? "disabled" : "active" })
      .where(eq(t.users.id, u.id))
      .returning();
    await audit(tx, { actorId: opts.actorId, action: opts.disabled ? "user.disable" : "user.enable", entity: "user", entityId: u.id });
    return rows;
  });
  if (after) await syncClerkMetadata(after).catch(() => undefined);
  return u.name;
}
