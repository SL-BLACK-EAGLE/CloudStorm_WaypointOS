import { ArrowLeft, Clock, RotateCcw, Truck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { and, eq, inArray } from "@waypoint/db/orm";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/wp/action-button";
import { WMark } from "@/components/wp/chips";
import { Panel, PanelHeader } from "@/components/wp/panel";
import { dayLabel, hhmm } from "@/lib/format";
import { ROLE_HOME } from "@/lib/roles";
import { now } from "@/lib/server/clock";
import { db, t } from "@/lib/server/db";
import { requireUser } from "@/lib/server/session";
import { cn } from "@/lib/utils";
import { driveVehicleAction, resetDemoAction, setClockAction } from "./actions";
import { ClockForm } from "./clock-form";

export const metadata: Metadata = { title: "Judge demo panel" };

const PRESETS = [
  { at: "2025-12-22T14:30", label: "Mon 14:30", what: "Store manager places OUT006's orders before the 16:00 cutoff" },
  { at: "2025-12-22T16:05", label: "Mon 16:05", what: "Cutoff passed: dispatcher plans, reviews deferrals, publishes" },
  { at: "2025-12-23T01:30", label: "Tue 01:30", what: "Loaders load in reverse stop order, flag shortfalls, sign off" },
  { at: "2025-12-23T03:30", label: "Tue 03:30", what: "Fresh departures; drivers start trips (try airplane mode)" },
  { at: "2025-12-23T06:30", label: "Tue 06:30", what: "Deliveries, proof of delivery, live ETAs, exceptions" },
  { at: "2025-12-23T09:00", label: "Tue 09:00", what: "Store managers confirm receipt; dispatcher reconciles" },
];

/** Judge panel: move the business clock through the walkthrough, pick the demo driver's vehicle, reset. */
export default async function DemoPage() {
  const user = await requireUser();
  const clock = await now();
  const plans = await db().select().from(t.plans).where(eq(t.plans.status, "published"));
  const trips = plans.length
    ? await db()
        .select({ vehicleId: t.trips.vehicleId, code: t.trips.code, district: t.trips.district, departureMin: t.trips.departureMin, depotId: t.plans.depotId, runDate: t.plans.runDate })
        .from(t.trips)
        .innerJoin(t.plans, eq(t.plans.id, t.trips.planId))
        .where(inArray(t.trips.planId, plans.map((p) => p.id)))
    : [];
  const [driver] = await db().select().from(t.users).where(and(eq(t.users.role, "driver"), eq(t.users.email, "driver+clerk_test@waypoint-demo.lk")));
  const byVehicle = new Map<string, typeof trips>();
  for (const tr of trips) byVehicle.set(tr.vehicleId, [...(byVehicle.get(tr.vehicleId) ?? []), tr]);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex items-center gap-3">
        <WMark size={36} />
        <div className="flex-1">
          <h1 className="text-xl font-semibold">Judge demo panel</h1>
          <p className="text-sm text-muted-foreground">Move through the 22–23 Dec 2025 walkthrough without waiting for real time.</p>
        </div>
        <Button asChild variant="outline" size="desk">
          <Link href={ROLE_HOME[user.role]}>
            <ArrowLeft /> Back to my workspace
          </Link>
        </Button>
      </header>

      <Panel>
        <PanelHeader title={<span className="flex items-center gap-2"><Clock className="size-4" /> Business clock</span>} aside={clock.running ? `running ×${clock.speed}` : "paused"} />
        <div className="space-y-4 p-4">
          <p className="num text-3xl font-semibold">
            {dayLabel(clock.date, true)} · {hhmm(clock.minute)}
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {PRESETS.map((p) => {
              const on = clock.iso.startsWith(p.at);
              return (
                <li key={p.at}>
                  <ActionButton action={setClockAction} fields={{ at: p.at, running: "0" }} variant="outline" className={cn("h-auto w-full flex-col items-start gap-0.5 whitespace-normal py-2 text-left", on && "border-foreground")}>
                    <span className="num font-semibold">{p.label}</span>
                    <span className="text-[13px] font-normal text-muted-foreground">{p.what}</span>
                  </ActionButton>
                </li>
              );
            })}
          </ul>
          <ClockForm current={clock.iso.slice(0, 16)} running={clock.running} speed={clock.speed} />
        </div>
      </Panel>

      <Panel>
        <PanelHeader title={<span className="flex items-center gap-2"><Truck className="size-4" /> Demo driver&apos;s vehicle</span>} aside={driver ? `${driver.name} drives ${driver.vehicleId ?? "nothing"}` : ""} />
        <div className="space-y-3 p-4">
          <p className="text-sm text-muted-foreground">
            Each vehicle has its own driver. For the walkthrough the demo driver account can take over any vehicle with a published trip - pick the one carrying
            OUT006&apos;s order, or a Kandy → Nuwara Eliya run for the dead-zone scenario.
          </p>
          {byVehicle.size === 0 && <p className="text-sm">No published plan yet. Publish one from the dispatcher&apos;s D-05 first.</p>}
          <div className="flex flex-wrap gap-2">
            {[...byVehicle].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([v, ts]) => (
              <ActionButton key={v} action={driveVehicleAction} fields={{ vehicleId: v }} variant={driver?.vehicleId === v ? "default" : "outline"} size="sm" className="h-auto flex-col items-start gap-0 py-1.5">
                <span className="num font-semibold">{v}</span>
                <span className="text-[11px] font-normal opacity-80">
                  {ts[0]!.depotId} · {ts.map((x) => `${x.district} ${hhmm(x.departureMin)}`).join(", ")}
                </span>
              </ActionButton>
            ))}
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title={<span className="flex items-center gap-2"><RotateCcw className="size-4" /> Reset</span>} />
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-muted-foreground">
            Restores the seeded day: order history, the 23 Dec queue (OUT006 not yet ordered), three vehicles in the workshop, weekly fuel, the forecast and the
            four demo accounts. Plans, loading and deliveries are cleared.
          </p>
          <ActionButton action={resetDemoAction} variant="destructive" size="desk" confirm="Reset all demo data to Mon 22 Dec 14:30?">
            <RotateCcw /> Reset demo data
          </ActionButton>
        </div>
      </Panel>
    </div>
  );
}
