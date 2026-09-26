import "server-only";
import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { eq } from "@waypoint/db/orm";
import { redirect } from "next/navigation";
import { cache } from "react";
import { ROLE_HOME, type Role } from "@/lib/roles";
import { db, t } from "./db";

export type AppUser = typeof t.users.$inferSelect;

/**
 * The signed-in user's Waypoint profile, created on first sign-in.
 *
 * Clerk proves identity; our users table decides authorization (role, status, scope).
 * A new Clerk account gets a pending profile and goes through /onboarding, where it
 * requests a role; a dispatcher approves it in /dispatch/users.
 */
export const getAppUser = cache(async (): Promise<AppUser | null> => {
  const { userId } = await auth();
  if (!userId) return null;
  const [byClerk] = await db().select().from(t.users).where(eq(t.users.clerkUserId, userId));
  if (byClerk) return byClerk;

  const cu = await currentUser();
  if (!cu) return null;
  const email = (cu.primaryEmailAddress?.emailAddress ?? cu.emailAddresses[0]?.emailAddress ?? "").toLowerCase();
  const name = [cu.firstName, cu.lastName].filter(Boolean).join(" ") || email.split("@")[0] || "New user";

  // a seeded profile with the same email (e.g. created before Clerk keys existed) is linked, not duplicated
  const [byEmail] = email ? await db().select().from(t.users).where(eq(t.users.email, email)) : [];
  if (byEmail) {
    const [linked] = await db().update(t.users).set({ clerkUserId: userId }).where(eq(t.users.id, byEmail.id)).returning();
    return linked ?? null;
  }
  const [created] = await db()
    .insert(t.users)
    .values({ clerkUserId: userId, email, name, status: "pending" })
    .onConflictDoNothing()
    .returning();
  return created ?? null;
});

/**
 * Guard for every page, route handler and server action.
 * Signed out -> sign-in; no approved role -> onboarding/pending; wrong role -> /forbidden.
 */
export async function requireUser(roles?: readonly Role[]): Promise<AppUser & { role: Role }> {
  await auth.protect();
  const user = await getAppUser();
  if (!user) redirect("/sign-in");
  if (user.status === "disabled") redirect("/forbidden?reason=disabled");
  if (user.status !== "active" || !user.role) redirect(user.requestedRole ? "/pending" : "/onboarding");
  if (roles && !roles.includes(user.role)) redirect(`/forbidden?need=${roles.join(",")}`);
  return user as AppUser & { role: Role };
}

/** For route handlers: returns null instead of redirecting. */
export async function userForApi(roles?: readonly Role[]): Promise<(AppUser & { role: Role }) | null> {
  const user = await getAppUser();
  if (!user || user.status !== "active" || !user.role) return null;
  if (roles && !roles.includes(user.role)) return null;
  return user as AppUser & { role: Role };
}

export function homeFor(user: Pick<AppUser, "role" | "status" | "requestedRole">): string {
  if (user.status === "active" && user.role) return ROLE_HOME[user.role];
  return user.requestedRole ? "/pending" : "/onboarding";
}

/** Mirrors role and scope into Clerk publicMetadata (read by the UI; authorization still uses the DB). */
export async function syncClerkMetadata(user: AppUser) {
  if (!user.clerkUserId || !process.env.CLERK_SECRET_KEY) return;
  const clerk = await clerkClient();
  await clerk.users.updateUserMetadata(user.clerkUserId, {
    publicMetadata: {
      role: user.role,
      status: user.status,
      depotId: user.depotId,
      outletId: user.outletId,
      vehicleId: user.vehicleId,
    },
  });
}
