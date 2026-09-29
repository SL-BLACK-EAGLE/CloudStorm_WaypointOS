import "server-only";
import { and, desc, eq, inArray, isNull, or, type SQL } from "@waypoint/db/orm";
import { db, t } from "./db";
import type { AppUser } from "./session";

/** Which notifications a person sees: addressed to them, to their role (in their depot), or to their outlet. */
function audience(user: AppUser): SQL {
  const parts: SQL[] = [eq(t.notifications.recipientUserId, user.id)];
  if (user.role) {
    const role = eq(t.notifications.recipientRole, user.role);
    parts.push(user.depotId ? and(role, or(isNull(t.notifications.depotId), eq(t.notifications.depotId, user.depotId)))! : role);
  }
  if (user.role === "store_manager" && user.outletId) parts.push(eq(t.notifications.outletId, user.outletId));
  return or(...parts)!;
}

export async function inbox(user: AppUser, limit = 30) {
  const rows = await db().select().from(t.notifications).where(audience(user)).orderBy(desc(t.notifications.createdAt)).limit(limit);
  const unread = rows.filter((r) => !r.readAt).length;
  return {
    unread,
    items: rows.map((r) => ({ id: r.id, title: r.title, body: r.body, link: r.link, severity: r.severity, at: r.createdAt.toISOString(), read: !!r.readAt })),
  };
}

/** Marks the given notifications (or all of them) read - only ones this person can see. */
export async function markRead(user: AppUser, ids?: string[]) {
  const where = ids?.length ? and(audience(user), inArray(t.notifications.id, ids), isNull(t.notifications.readAt)) : and(audience(user), isNull(t.notifications.readAt));
  await db().update(t.notifications).set({ readAt: new Date() }).where(where);
}
