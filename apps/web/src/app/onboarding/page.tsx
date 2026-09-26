import { auth } from "@clerk/nextjs/server";
import { asc } from "@waypoint/db/orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/wp/auth-shell";
import { db, t } from "@/lib/server/db";
import { getAppUser } from "@/lib/server/session";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Request access" };

export default async function OnboardingPage() {
  await auth.protect();
  const user = await getAppUser();
  if (!user) redirect("/sign-in");
  if (user.status === "active" && user.role) redirect("/app");

  const [outlets, vehicles] = await Promise.all([
    db()
      .select({ id: t.outlets.id, name: t.outlets.name, brand: t.outlets.brand, district: t.outlets.district })
      .from(t.outlets)
      .orderBy(asc(t.outlets.id)),
    db()
      .select({ id: t.vehicles.id, type: t.vehicles.type, temp: t.vehicles.temp, depotId: t.vehicles.depotId })
      .from(t.vehicles)
      .orderBy(asc(t.vehicles.id)),
  ]);

  return (
    <AuthShell>
      <div className="w-full max-w-xl space-y-6">
        <header className="space-y-2">
          <p className="num text-xs tracking-widest text-muted-foreground uppercase">Step 2 of 3 · request access</p>
          <h1 className="text-2xl font-semibold tracking-tight">What is your job at Waypoint?</h1>
          <p className="text-sm text-muted-foreground">
            Your account is created. A dispatcher checks every request before it can see orders, plans or deliveries - so a
            new account can never act as a dispatcher on its own.
          </p>
        </header>
        <OnboardingForm defaultName={user.name} outlets={outlets} vehicles={vehicles} />
      </div>
    </AuthShell>
  );
}
