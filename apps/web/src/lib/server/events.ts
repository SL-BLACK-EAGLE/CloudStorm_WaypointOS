import "server-only";
import type { Executor } from "@waypoint/db";
import { t } from "./db";
import type { Role } from "@/lib/roles";

/**
 * Transactional outbox. Every business write calls emit() inside the same transaction,
 * so the realtime layer (Convex) can never show a change that did not commit, and a
 * committed change is never lost: the relay retries until each row is delivered.
 */
export async function emit(tx: Executor, topic: string, payload: Record<string, unknown>) {
  await tx.insert(t.outbox).values({ topic, payload });
}

export interface NotifyInput {
  type: string;
  title: string;
  body: string;
  link?: string;
  severity?: "info" | "late-risk" | "conflict" | "exception";
  recipientUserId?: string;
  recipientRole?: Role;
  outletId?: string;
  depotId?: string;
}

/** Writes a notification row and its realtime event in the caller's transaction. */
export async function notify(tx: Executor, n: NotifyInput) {
  const [row] = await tx
    .insert(t.notifications)
    .values({
      type: n.type,
      title: n.title,
      body: n.body,
      link: n.link,
      severity: n.severity ?? "info",
      recipientUserId: n.recipientUserId,
      recipientRole: n.recipientRole,
      outletId: n.outletId,
      depotId: n.depotId,
    })
    .returning({ id: t.notifications.id, createdAt: t.notifications.createdAt });
  await emit(tx, "notification.created", { ...n, id: row!.id, createdAt: row!.createdAt.toISOString() });
}

/** Records who did what, for manual overrides and approvals. */
export async function audit(
  tx: Executor,
  a: { actorId: string; action: string; entity: string; entityId: string; before?: unknown; after?: unknown; justification?: string },
) {
  await tx.insert(t.auditLog).values({
    actorId: a.actorId,
    action: a.action,
    entity: a.entity,
    entityId: a.entityId,
    before: a.before ?? null,
    after: a.after ?? null,
    justification: a.justification,
  });
}
