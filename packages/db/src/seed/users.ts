/**
 * The four demo accounts (one per role). With CLERK_SECRET_KEY set they are created in
 * Clerk (idempotent: an existing user with the same email is reused) and linked by
 * clerk_user_id. Role and scope live in our users table - the source of truth for
 * authorization - and are mirrored into Clerk publicMetadata for fast checks in the proxy.
 */
import { createClerkClient } from "@clerk/backend";
import { eq } from "drizzle-orm";
import type { Database } from "../client";
import { users } from "../schema";
import { DEMO_PASSWORD, DEMO_USERS } from "./scenario";

export async function seedUsers(db: Database) {
  const secretKey = process.env.CLERK_SECRET_KEY;
  const clerk = secretKey ? createClerkClient({ secretKey }) : null;
  if (!clerk) console.log("  CLERK_SECRET_KEY not set: demo users created without Clerk accounts");

  for (const u of DEMO_USERS) {
    const [firstName, ...rest] = u.name.split(" ");
    let clerkUserId: string | null = null;
    if (clerk) {
      const found = await clerk.users.getUserList({ emailAddress: [u.email], limit: 1 });
      const existing = found.data[0];
      const user =
        existing ??
        (await clerk.users.createUser({
          emailAddress: [u.email],
          password: DEMO_PASSWORD,
          firstName,
          lastName: rest.join(" "),
          skipPasswordChecks: true,
          skipLegalChecks: true,
        }));
      await clerk.users.updateUserMetadata(user.id, {
        publicMetadata: { role: u.role, status: "active", depotId: u.depotId, outletId: u.outletId, vehicleId: u.vehicleId },
      });
      clerkUserId = user.id;
    }
    const values = {
      clerkUserId,
      email: u.email,
      name: u.name,
      role: u.role,
      requestedRole: u.role,
      status: "active" as const,
      depotId: u.depotId,
      outletId: u.outletId,
      vehicleId: u.vehicleId,
      approvedAt: new Date(),
    };
    const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, u.email));
    if (row) await db.update(users).set(values).where(eq(users.id, row.id));
    else await db.insert(users).values(values);
    console.log(`  ${u.role.padEnd(13)} ${u.email}${clerkUserId ? ` (clerk ${clerkUserId})` : ""}`);
  }
}
