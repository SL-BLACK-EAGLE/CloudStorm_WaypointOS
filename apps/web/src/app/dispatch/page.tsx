import { PageTour } from "@/components/wp/tour";
import { TOWER_TOUR } from "@/lib/tours/dispatcher";
import { Check, Circle, CircleDashed, Fuel, Play, Snowflake, Timer, Truck } from "lucide-react";
import type { Metadata } from "next";
import { RealtimeRefresh } from "@/components/wp/realtime";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/wp/action-button";
import { Meter } from "@/components/wp/meter";
import { Kpi, Panel, PanelHeader } from "@/components/wp/panel";
import { dayLabel, hhmm, int, kg } from "@/lib/format";
import { eq, and, inArray } from "@waypoint/db/orm";
import { db, t } from "@/lib/server/db";
import { currentPlan } from "@/lib/server/planning";
import { dayConditions } from "@/lib/server/queries/day-context";
import { planView, queue } from "@/lib/server/queries/plan-view";
import { reference } from "@/lib/server/reference";
import { runs } from "@/lib/server/runs";
import { FRESH_WINDOW } from "@/lib/time-rules";
import { cn } from "@/lib/utils";
import { DispatchHeader } from "./_components/header";
import { autoPlanAction } from "./actions";
import { currentDepot } from "./depot";

export const metadata: Metadata = { title: "D-01 Control tower" };

export default async function ControlTowerPage() {
  const depot = await currentDepot();
  const { planning, cutoffPassed } = await runs();
  const [R, cond, orders, plan] = await Promise.all([reference(), dayConditions(planning), queue(depot, planning), currentPlan(depot, planning)]);
  const view = plan ? await planView(plan.id) : null;

  const fleet = [...R.vehicles.values()].filter((v) => v.depot === depot);
  const dayRows = await db()
    .select({ vehicleId: t.vehicleDays.vehicleId, status: t.vehicleDays.status })
    .from(t.vehicleDays)
    .where(and(eq(t.vehicleDays.date, planning), inArray(t.vehicleDays.vehicleId, fleet.map((v) => v.id))));
  const workshop = new Set(dayRows.filter((d) => d.status === "in_workshop").map((d) => d.vehicleId));
  const available = fleet.filter((v) => !workshop.has(v.id));
  const cal = R.calendar.get(planning)!;
  const fuelRows = await db()
    .select()
    .from(t.fuelLedger)
    .where(and(eq(t.fuelLedger.isoYear, cal.isoYear), eq(t.fuelLedger.isoWeek, cal.isoWeek)));
  const fuelUsed = new Map(fuelRows.map((f) => [f.vehicleId, f.litresUsed]));

  // ── demand
  const byBrand = { Fresh: 0, Style: 0, Tech: 0 } as Record<string, number>;
  for (const o of orders) byBrand[o.brand] = (byBrand[o.brand] ?? 0) + 1;
  const chilled = orders.filter((o) => o.temp === "chilled");
  const vanOnly = orders.filter((o) => o.parking === "van_only");

  // ── plan
  const trips = view?.trips ?? [];
  const deferrals = view?.deferrals ?? [];
  const deferredIds = new Set(deferrals.map((d) => d.orderId));
  const stopsCount = trips.reduce((n, tr) => n + tr.stops.length, 0);
  const vehiclesUsed = new Set(trips.map((tr) => tr.vehicleId));
  const reefers = available.filter((v) => v.temp === "reefer");
  const vans = available.filter((v) => v.type === "van");
  const freshTrips = trips.filter((tr) => tr.brand === "Fresh");
  const freshVehicles = new Set(freshTrips.map((tr) => tr.vehicleId));
  const freshUsed = freshTrips.reduce((s, tr) => s + tr.tripMinutes, 0);
  const freshCap = freshVehicles.size * FRESH_WINDOW.budget;
  const reeferFresh = freshTrips.filter((tr) => tr.vTemp === "reefer").reduce((s, tr) => s + tr.tripMinutes, 0);
  const minutesByVehicle = new Map<string, number>();
  for (const tr of freshTrips) minutesByVehicle.set(tr.vehicleId, (minutesByVehicle.get(tr.vehicleId) ?? 0) + tr.tripMinutes);
  const nearBudget = [...minutesByVehicle].filter(([, m]) => m >= FRESH_WINDOW.budget * 0.95);
  const litres = trips.reduce((s, tr) => s + tr.litres, 0);
  const litresByVehicle = new Map<string, number>();
  for (const tr of trips) litresByVehicle.set(tr.vehicleId, (litresByVehicle.get(tr.vehicleId) ?? 0) + tr.litres);
  const fuelShare = [...litresByVehicle].map(([v, l]) => {
    const q = R.vehicles.get(v)!.weeklyQuotaL;
    return { v, share: (l + (fuelUsed.get(v) ?? 0)) / q, l, used: fuelUsed.get(v) ?? 0, q };
  });
  const topFuel = fuelShare.sort((a, b) => b.share - a.share)[0];

  const firstDep = Math.min(...trips.map((tr) => tr.departureMin ?? Infinity));
  const firstVehicles = trips.filter((tr) => tr.departureMin === firstDep).map((tr) => tr.vehicleId);
  const chosen = deferrals.filter((d) => d.kind === "CHOSEN");
  const unavoidable = deferrals.filter((d) => d.kind === "UNAVOIDABLE");
  // outlets skipped on the previous run and deferred again are flagged red and need a recorded reason
  // the fairness snapshot taken when the plan was made (publishing later marks every deferred order as skipped)
  const skippedBefore = new Set(deferrals.filter((d) => (d.fairness as { deferredYesterday?: number } | null)?.deferredYesterday).map((d) => d.orderId));
  const repeat = deferrals.filter((d) => skippedBefore.has(d.orderId));
  const undecidedChosen = deferrals.filter((d) => !d.decidedAt && (d.kind === "CHOSEN" || skippedBefore.has(d.orderId)));

  // which resource binds hardest: count deferrals attributable to each
  const load = {
    reefer: deferrals.filter((d) => d.temp === "chilled" && d.parking !== "van_only").length,
    vans: deferrals.filter((d) => d.parking === "van_only").length,
    fresh: deferrals.filter((d) => ["R7_FRESH_BUDGET_270", "WINDOW_LATE", "TRIP2_WINDOW_LATE"].includes(d.reasonCode)).length,
    fuel: deferrals.filter((d) => d.reasonCode === "FUEL_QUOTA").length,
  };
  const limiting = deferrals.length ? (Object.entries(load).sort((a, b) => b[1] - a[1])[0]![0] as keyof typeof load) : null;

  // ── demand by district
  const districts = [...R.districts.values()].filter((d) => d.depot === depot);
  const table = districts.map((d) => {
    const os = orders.filter((o) => o.district === d.name);
    return {
      name: d.name,
      from: d.outboundMin,
      chilled: os.filter((o) => o.temp === "chilled").length,
      ambient: os.filter((o) => o.temp === "ambient" && o.brand !== "Tech").length,
      tech: os.filter((o) => o.brand === "Tech").length,
      kg: os.reduce((s, o) => s + o.kg, 0),
      deferred: os.filter((o) => deferredIds.has(o.id)).length,
    };
  });
  const tot = table.reduce(
    (a, r) => ({ chilled: a.chilled + r.chilled, ambient: a.ambient + r.ambient, tech: a.tech + r.tech, kg: a.kg + r.kg, deferred: a.deferred + r.deferred }),
    { chilled: 0, ambient: 0, tech: 0, kg: 0, deferred: 0 },
  );

  const published = plan?.status === "published";
  const checklist = [
    { done: cutoffPassed, title: "Orders closed at 16:00", sub: cutoffPassed ? `${orders.length} confirmed · later orders go to the next run` : "Orders still open - the queue can still grow", href: "/dispatch/orders" },
    { done: !!plan, title: "Draft plan passes rules 1–7", sub: plan ? `${trips.length} trips · 0 violations (checked by the planner)` : "Run auto-plan to build it", href: "/dispatch/plan" },
    { done: !!plan && undecidedChosen.length === 0, title: `Decide ${undecidedChosen.length} deferral${undecidedChosen.length === 1 ? "" : "s"}`, sub: repeat.length ? `${repeat.length} outlet(s) skipped twice in a row need a reason` : `${unavoidable.length} unavoidable already have reasons`, href: "/dispatch/deferrals" },
    { done: published, title: "Publish to loaders, drivers, stores", sub: firstDep < Infinity ? `Before the ${hhmm(firstDep)} departures` : "After the plan is ready", href: "/dispatch/publish" },
  ];

  return (
    <>
      <RealtimeRefresh channels={["orders"]} fallbackSeconds={60} />
      <PageTour id="d01" steps={TOWER_TOUR} />
      <DispatchHeader
        title="Control tower"
        context={`${depot} · run for ${dayLabel(planning, true)}${cond.text ? ` · ${cond.text}` : ""}`}
        depot={depot}
      />
      <main className="space-y-6 p-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-tour="kpis">
          <Kpi
            label="Confirmed orders"
            value={int(orders.length)}
            sub={`Fresh ${byBrand.Fresh} · Tech ${byBrand.Tech} · Style ${byBrand.Style} · ${cutoffPassed ? "closed 16:00" : "open until 16:00"}`}
          />
          <Kpi
            label="Draft plan"
            value={plan ? `${trips.length} trips` : "—"}
            sub={plan ? `${vehiclesUsed.size} vehicles · ${stopsCount} stops · 0 rule violations` : "No plan yet for this run"}
          />
          <Kpi
            label={published ? "Deferred in published plan" : "Deferred in draft"}
            value={plan ? deferrals.length : "—"}
            tone={repeat.length ? "violation" : deferrals.length ? "deferred" : undefined}
            sub={
              plan ? (
                <Link href="/dispatch/deferrals" className="text-deferred underline-offset-4 hover:underline">
                  {repeat.length > 0 && <span className="font-semibold text-violation">{repeat.length} skipped twice in a row · </span>}
                  {chosen.length} chosen · {unavoidable.length} unavoidable · review
                </Link>
              ) : (
                "—"
              )
            }
          />
          <Kpi
            label="First departure"
            value={firstDep < Infinity ? hhmm(firstDep) : "—"}
            sub={firstVehicles.length ? `${firstVehicles.slice(0, 3).join(", ")} · publish before` : "After planning"}
          />
        </div>

        {!plan && (
          <Panel className="flex flex-wrap items-center justify-between gap-4 p-5" data-tour="autoplan">
            <div>
              <h2 className="font-semibold">No plan for {dayLabel(planning)} yet</h2>
              <p className="text-sm text-muted-foreground">
                The planner allocates the scarcest resources first - van-only chilled, chilled, van-only ambient - then explains every
                deferral. It takes well under a second.
              </p>
            </div>
            <ActionButton action={autoPlanAction} fields={{ depot }} size="desk">
              <Play /> Run auto-plan
            </ActionButton>
          </Panel>
        )}

        <section className="space-y-3" data-tour="resources">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h2 className="text-lg font-semibold">Demand against capacity, by limiting resource</h2>
            <p className="text-sm text-muted-foreground">
              {plan ? `${published ? "Published" : "Draft"} plan v${plan.version}` : "Queue only"} · {depot} fleet of {fleet.length} ({workshop.size} in workshop)
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <ResourceCard
              icon={<Snowflake className="size-4 text-chilled" />}
              title="Reefer capacity"
              limiting={limiting === "reefer"}
              headline={`${chilled.length} chilled orders`}
              body={`${chilled.length - deferrals.filter((d) => d.temp === "chilled").length} planned, ${deferrals.filter((d) => d.temp === "chilled").length} deferred. ${new Set(trips.filter((tr) => tr.vTemp === "reefer").map((tr) => tr.vehicleId)).size} of ${reefers.length} reefers have trips.`}
              meter={{ used: reeferFresh, total: reefers.length * FRESH_WINDOW.budget, label: "Reefer Fresh minutes" }}
              foot="Chilled orders need a reefer; reefers also carry ambient goods."
            />
            <ResourceCard
              icon={<Truck className="size-4" />}
              title="Vans for van_only outlets"
              limiting={limiting === "vans"}
              headline={`${vanOnly.length} van_only orders`}
              body={`${vanOnly.filter((o) => !deferredIds.has(o.id)).length} planned, ${vanOnly.filter((o) => deferredIds.has(o.id)).length} deferred. ${fleet.filter((v) => v.type === "van" && workshop.has(v.id)).length} van(s) in the workshop.`}
              meter={{ used: new Set(trips.filter((tr) => tr.vType === "van").map((tr) => tr.vehicleId)).size, total: vans.length, label: "Vans with trips", tone: "neutral" }}
              foot="Trucks cannot reach van_only outlets."
            />
            <ResourceCard
              icon={<Timer className="size-4" />}
              title="Fresh minutes"
              limiting={limiting === "fresh"}
              headline={`${int(freshUsed)} / ${int(freshCap)}`}
              body={`${freshVehicles.size} vehicles × 270-min budget, 03:30–08:00 window.`}
              meter={{ used: freshUsed, total: freshCap || 1, label: "Used", valueLabel: freshCap ? `${Math.round((freshUsed / freshCap) * 100)}%` : "—" }}
              foot={
                nearBudget.length ? (
                  <span className="text-late-risk">
                    {nearBudget.slice(0, 3).map(([v]) => v).join(", ")} at ≥ 95% of 270
                  </span>
                ) : (
                  "No vehicle is near its Fresh budget."
                )
              }
            />
            <ResourceCard
              icon={<Fuel className="size-4" />}
              title="Fuel"
              limiting={limiting === "fuel"}
              headline={`${litres.toFixed(1)} L planned`}
              body={`Outbound + return km ÷ km/L for ${vehiclesUsed.size} vehicles.`}
              meter={
                topFuel
                  ? { used: topFuel.share * 100, total: 100, label: "Highest share of weekly quota", valueLabel: `${(topFuel.share * 100).toFixed(1)}%` }
                  : { used: 0, total: 100, label: "Highest share of weekly quota", valueLabel: "—" }
              }
              foot={topFuel ? `${topFuel.v}: ${(topFuel.used + topFuel.l).toFixed(1)} of ${topFuel.q} L this ISO week.` : "No trips yet."}
            />
          </div>
        </section>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Panel className="overflow-hidden" data-tour="districts">
            <PanelHeader title="Demand by district" aside="One brand and one district per trip" />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-[13px] text-muted-foreground">
                  <tr className="border-b">
                    <th className="px-4 py-2 font-medium">District</th>
                    <th className="px-3 py-2 text-right font-medium">From depot</th>
                    <th className="px-3 py-2 text-right font-medium">Chilled</th>
                    <th className="px-3 py-2 text-right font-medium">Ambient</th>
                    <th className="px-3 py-2 text-right font-medium">Tech</th>
                    <th className="px-3 py-2 text-right font-medium">Weight</th>
                    <th className="px-4 py-2 text-right font-medium">Deferred</th>
                  </tr>
                </thead>
                <tbody>
                  {table.map((r) => (
                    <tr key={r.name} className="border-b last:border-0">
                      <td className="px-4 py-2 font-medium">{r.name}</td>
                      <td className="num px-3 py-2 text-right text-muted-foreground">{r.from} min</td>
                      <td className="num px-3 py-2 text-right">{r.chilled}</td>
                      <td className="num px-3 py-2 text-right">{r.ambient}</td>
                      <td className="num px-3 py-2 text-right">{r.tech}</td>
                      <td className="num px-3 py-2 text-right">{kg(r.kg)}</td>
                      <td className={cn("num px-4 py-2 text-right", r.deferred ? "text-deferred" : "text-muted-foreground")}>{r.deferred}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t font-semibold">
                    <td className="px-4 py-2">Total</td>
                    <td />
                    <td className="num px-3 py-2 text-right">{tot.chilled}</td>
                    <td className="num px-3 py-2 text-right">{tot.ambient}</td>
                    <td className="num px-3 py-2 text-right">{tot.tech}</td>
                    <td className="num px-3 py-2 text-right">{kg(tot.kg)}</td>
                    <td className="num px-4 py-2 text-right text-deferred">{tot.deferred}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Panel>

          <Panel className="flex flex-col" data-tour="tonight">
            <PanelHeader title="Tonight" />
            <ol className="flex-1 space-y-4 p-4">
              {checklist.map((c, i) => {
                const nextUp = !c.done && checklist.slice(0, i).every((x) => x.done);
                return (
                  <li key={c.title} className="flex gap-3">
                    {c.done ? (
                      <Check className="mt-0.5 size-5 shrink-0" aria-label="done" />
                    ) : nextUp ? (
                      <Circle className="mt-0.5 size-5 shrink-0 text-deferred" aria-label="next" />
                    ) : (
                      <CircleDashed className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-label="later" />
                    )}
                    <div>
                      <Link href={c.href} className={cn("font-medium underline-offset-4 hover:underline", nextUp && "underline")}>
                        {c.title}
                      </Link>
                      <p className="text-[13px] text-muted-foreground">{c.sub}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
            <div className="p-4 pt-0">
              {plan ? (
                <Button asChild size="desk" variant={published ? "outline" : "secondary"} className="w-full">
                  <Link href={published ? "/dispatch/live" : deferrals.length ? "/dispatch/deferrals" : "/dispatch/publish"}>
                    {published ? "Watch live operations" : deferrals.length ? "Review deferrals" : "Publish plan"}
                  </Link>
                </Button>
              ) : (
                <ActionButton action={autoPlanAction} fields={{ depot }} size="desk" className="w-full">
                  <Play /> Run auto-plan
                </ActionButton>
              )}
            </div>
          </Panel>
        </div>
      </main>
    </>
  );
}

function ResourceCard({
  icon,
  title,
  limiting,
  headline,
  body,
  meter,
  foot,
}: {
  icon: React.ReactNode;
  title: string;
  limiting: boolean;
  headline: string;
  body: string;
  meter: { used: number; total: number; label: string; valueLabel?: string; tone?: "neutral" };
  foot: React.ReactNode;
}) {
  return (
    <Panel className={cn("flex flex-col gap-3 p-4", limiting && "border-late-risk-border")}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          {icon}
          {title}
        </h3>
        {limiting && (
          <span className="rounded-full border border-late-risk-border bg-late-risk-bg px-2 py-0.5 text-[12px] font-semibold text-late-risk">
            Limiting
          </span>
        )}
      </div>
      <p className="num text-xl font-semibold">{headline}</p>
      <p className="text-[13px] text-muted-foreground">{body}</p>
      <Meter used={meter.used} total={meter.total} label={meter.label} valueLabel={meter.valueLabel} tone={meter.tone ?? "auto"} />
      <p className="text-[12px] text-muted-foreground">{foot}</p>
    </Panel>
  );
}
