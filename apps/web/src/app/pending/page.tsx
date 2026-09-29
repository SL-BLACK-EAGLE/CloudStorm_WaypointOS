import { SignOutButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { Clock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/components/wp/auth-shell";
import { StatusPill } from "@/components/wp/chips";
import { RealtimeRefresh } from "@/components/wp/realtime";
import { and, desc, eq } from "@waypoint/db/orm";
import { db, t } from "@/lib/server/db";
import { ROLE_LABEL } from "@/lib/roles";
import { getAppUser } from "@/lib/server/session";

export const metadata: Metadata = { title: "Waiting for approval" };

export default async function PendingPage() {
  await auth.protect();
  const user = await getAppUser();
  if (!user) redirect("/sign-in");
  if (user.status === "active" && user.role) redirect("/app");
  if (!user.requestedRole) redirect("/onboarding");
  const rejected = user.status === "rejected";
  const [reason] = rejected
    ? await db()
        .select({ body: t.notifications.body })
        .from(t.notifications)
        .where(and(eq(t.notifications.recipientUserId, user.id), eq(t.notifications.type, "access.rejected")))
        .orderBy(desc(t.notifications.createdAt))
        .limit(1)
    : [];

  return (
    <AuthShell>
      {!rejected && <RealtimeRefresh channels={[`user:${user.id}`]} fallbackSeconds={10} />}
      <div className="w-full max-w-md space-y-6">
        <p className="num text-xs tracking-widest text-muted-foreground uppercase">Step 3 of 3 · approval</p>
        <div className="space-y-3">
          <StatusPill status={rejected ? "exception" : "planned"}>{rejected ? "Not approved" : "Waiting for a dispatcher"}</StatusPill>
          <h1 className="text-2xl font-semibold tracking-tight">
            {rejected ? "Your request was not approved" : "Request sent"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {rejected
              ? `A dispatcher declined this request${reason ? `: “${reason.body}”` : "."} You can change the request and send it again.`
              : "A dispatcher at the Peliyagoda planning office will check it. This page opens your workspace as soon as they approve."}
          </p>
        </div>
        <dl className="divide-y rounded-lg border bg-card text-sm">
          <div className="flex justify-between gap-4 p-3">
            <dt className="text-muted-foreground">Name</dt>
            <dd className="font-medium">{user.name}</dd>
          </div>
          <div className="flex justify-between gap-4 p-3">
            <dt className="text-muted-foreground">Requested role</dt>
            <dd className="font-medium">{ROLE_LABEL[user.requestedRole]}</dd>
          </div>
          {user.outletId && (
            <div className="flex justify-between gap-4 p-3">
              <dt className="text-muted-foreground">Outlet</dt>
              <dd className="num font-medium">{user.outletId}</dd>
            </div>
          )}
          {user.depotId && (
            <div className="flex justify-between gap-4 p-3">
              <dt className="text-muted-foreground">Depot</dt>
              <dd className="font-medium">{user.depotId}</dd>
            </div>
          )}
        </dl>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button asChild size="desk" className="flex-1">
            <Link href="/pending">
              <Clock /> Check again
            </Link>
          </Button>
          <Button asChild size="desk" variant="outline" className="flex-1">
            <Link href="/onboarding">Change request</Link>
          </Button>
          <SignOutButton redirectUrl="/">
            <Button size="desk" variant="ghost" className="flex-1">
              Sign out
            </Button>
          </SignOutButton>
        </div>
      </div>
    </AuthShell>
  );
}
