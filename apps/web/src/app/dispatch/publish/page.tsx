import { PageTour } from "@/components/wp/tour";
import { PUBLISH_TOUR } from "@/lib/tours/dispatcher";
import { Ban, Check, Package, Printer, Send, Smartphone, Store, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { RULE_TEXT } from "@waypoint/planner";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/wp/action-button";
import { Kpi, Panel, PanelHeader } from "@/components/wp/panel";
import { dayLabel, hhmm, kg } from "@/lib/format";
import { prePublishChecks } from "@/lib/server/plan-decide";
import { currentPlan, publishedPlan } from "@/lib/server/planning";
import { planView } from "@/lib/server/queries/plan-view";
import { runs } from "@/lib/server/runs";
import { cn } from "@/lib/utils";
import { DispatchHeader } from "../_components/header";
import { currentDepot } from "../depot";
import { publishAction } from "./actions";

export const metadata: Metadata = { title: "D-05 Publish plan" };

export default async function PublishPage({ searchParams }: PageProps<"/dispatch/publish">) {
  const depot = await currentDepot();
  const { planning, cutoffPassed } = await runs();
  const plan = await currentPlan(depot, planning);
  if (!plan) {
    return (
      <>
        <DispatchHeader title="Publish plan" context={`${depot} · run for ${dayLabel(planning, true)}`} depot={depot} />
        <main className="p-6">
          <Panel className="p-6 text-sm">
            No plan to publish yet. <Link href="/dispatch" className="underline">Run auto-plan</Link> first.
          </Panel>
        </main>
      </>
    );
  }
  const [checks, view, live] = await Promise.all([prePublishChecks(plan.id), planView(plan.id), publishedPlan(depot, planning)]);
  const sp = await searchParams;
  const trips = view.trips;
  const stops = trips.flatMap((tr) => tr.stops.map((s) => ({ ...s, trip: tr })));
  const onTime = stops.filter((s) => (s.plannedArrive ?? 0) <= s.close).length;
  const risky = stops.filter((s) => s.lateRisk).sort((a, b) => a.close - (a.expectedArrive ?? 0) - (b.close - (b.expectedArrive ?? 0)));
  const freshBy = new Map<string, number>();
  for (const tr of trips) if (tr.brand === "Fresh") freshBy.set(tr.vehicleId, (freshBy.get(tr.vehicleId) ?? 0) + tr.tripMinutes);
  const topFresh = [...freshBy].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const vehicles = [...new Set(trips.map((tr) => tr.vehicleId))];
  const twoTrips = vehicles.filter((v) => trips.filter((tr) => tr.vehicleId === v).length > 1);
  const firstDep = Math.min(...trips.map((tr) => tr.departureMin ?? Infinity));
  const firstOut = trips.filter((tr) => tr.departureMin === firstDep).map((tr) => tr.vehicleId);
  const outlets = new Set(stops.map((s) => s.outletId));
  const deferred = view.deferrals;
  const undecided = checks.undecided.length;
  const published = plan.status === "published";
  const blocked = checks.violations.length > 0 || undecided > 0;
  const preview = trips.find((tr) => tr.id === sp.trip) ?? trips.find((tr) => tr.stops.length > 3) ?? trips[0];

  const checklist = [
    {
      ok: checks.violations.length === 0,
      t: "Feasibility rules 1–7",
      d: checks.violations.length
        ? `Breaks: ${checks.violations.join(", ")}`
        : `${trips.length} trips · 0 violations (re-checked now by the planner)${
            checks.accepted.length
              ? ` · ${checks.accepted.length} override(s) accepted: ${checks.accepted.map((a) => `${a.vehicleId} ${(RULE_TEXT[a.code] ?? a.code).toLowerCase()} - "${a.justification}"`).join("; ")}`
              : ""
          }`,
    },
    { ok: onTime === stops.length, t: "Delivery windows", d: `${onTime} of ${stops.length} planned arrivals before window close` },
    { ok: true, t: "Fresh budget (270 min)", d: topFresh.length ? `Highest ${topFresh.map(([v, m]) => `${v} ${m}`).join(" · ")}` : "No Fresh trips" },
    {
      ok: undecided === 0,
      t: "Deferrals recorded",
      d: undecided
        ? `${undecided} deferral(s) still need a decision${checks.repeat.length ? ` · ${checks.repeat.length} outlet(s) would miss a second run in a row` : ""}`
        : `${deferred.length} deferred, each with a reason${checks.repeat.length ? ` · ${checks.repeat.length} repeat deferral(s) justified` : ""}`,
    },
  ];

  return (
    <>
      <PageTour id="d05" steps={PUBLISH_TOUR} />
      <DispatchHeader
        title="Publish plan"
        context={`${depot} · run for ${dayLabel(planning, true)} · ${published ? `Plan v${plan.version} (published)` : `Draft ${plan.version} → Plan v${plan.version}`}`}
        depot={depot}
      />
      <main className="grid gap-5 p-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Panel data-tour="checks">
            <PanelHeader title="Pre-publish checks" aside={`${checklist.filter((c) => c.ok).length} pass${risky.length ? ` · ${Math.min(risky.length, 99)} late risk watched` : ""}`} />
            <ul className="space-y-3 p-4">
              {checklist.map((c) => (
                <li key={c.t} className="flex gap-3 text-sm">
                  {c.ok ? <Check className="mt-0.5 size-4 shrink-0" /> : <Ban className="mt-0.5 size-4 shrink-0 text-violation" />}
                  <div>
                    <p className="font-medium">{c.t}</p>
                    <p className="text-[13px] text-muted-foreground">{c.d}</p>
                  </div>
                </li>
              ))}
              {risky.length > 0 && (
                <li className="flex gap-3 text-sm">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-late-risk" />
                  <div>
                    <p className="font-medium text-late-risk">Accepted late risk</p>
                    <p className="text-[13px] text-muted-foreground">
                      {risky.slice(0, 3).map((s) => `${s.outletId} on ${s.trip.vehicleId} (expected ${hhmm(s.expectedArrive)}, closes ${hhmm(s.close)})`).join("; ")}
                      {risky.length > 3 && ` and ${risky.length - 3} more`}. Expected times use traffic and road disruption; these are watched live in D-06.
                    </p>
                  </div>
                </li>
              )}
            </ul>
          </Panel>

          <Panel data-tour="recipients">
            <PanelHeader title="What each role receives" />
            <div className="grid gap-4 p-4 lg:grid-cols-3">
              <div className="space-y-1.5 text-sm">
                <p className="flex items-center gap-2 font-semibold"><Package className="size-4" /> Loaders · dock tablet</p>
                <p className="num text-2xl font-semibold">{trips.length} load lists</p>
                <p className="text-[13px] text-muted-foreground">
                  In reverse stop order, queued by departure. First out at {hhmm(firstDep)}: {firstOut.slice(0, 3).join(", ")}.
                </p>
                <p className="text-[13px] text-muted-foreground">Shortfalls flagged at the dock come back to live operations before departure.</p>
              </div>
              <div className="space-y-1.5 text-sm">
                <p className="flex items-center gap-2 font-semibold"><Smartphone className="size-4" /> Drivers · own phone</p>
                <p className="num text-2xl font-semibold">{vehicles.length} · {trips.length} trips</p>
                <p className="text-[13px] text-muted-foreground">
                  Each run downloads as an offline pack with stops, windows, dock type and access notes. PoDs queue on the phone when coverage drops.
                </p>
                {twoTrips.length > 0 && <p className="text-[13px] text-muted-foreground">Two trips: {twoTrips.join(" · ")}</p>}
              </div>
              <div className="space-y-1.5 text-sm">
                <p className="flex items-center gap-2 font-semibold"><Store className="size-4" /> Store managers · counter</p>
                <p className="num text-2xl font-semibold">{outlets.size} outlets</p>
                <p className="text-[13px] text-muted-foreground">Every outlet with a delivery gets its expected arrival, so it can schedule receiving staff.</p>
                {deferred.length > 0 && (
                  <p className="text-[13px] text-deferred">
                    {deferred.length} deferral notice{deferred.length === 1 ? "" : "s"}: {deferred.slice(0, 6).map((d) => d.outletId).join(", ")}
                    {deferred.length > 6 && "…"} · with the reason and the new run
                  </p>
                )}
              </div>
            </div>
          </Panel>

          <div className="grid gap-4 sm:grid-cols-4" data-tour="totals">
            <Kpi label="Served" value={stops.length} />
            <Kpi label="Deferred" value={deferred.length} tone={deferred.length ? "deferred" : undefined} />
            <Kpi label="Trips" value={trips.length} />
            <Kpi label="Vehicles" value={vehicles.length} />
          </div>
        </div>

        <aside className="space-y-4">
          {preview && (
            <Panel data-tour="loader-preview">
              <PanelHeader title={`Loader preview · ${preview.code}`} aside={`${preview.vehicleId} · dep ${hhmm(preview.departureMin)}`} />
              <p className="px-4 pt-3 text-[13px] text-muted-foreground">Load first = last stop</p>
              <ol className="divide-y px-4 pb-3">
                {[...preview.stops].reverse().map((s, i) => (
                  <li key={s.id} className="flex items-center gap-3 py-2 text-sm">
                    <span className="num w-5 text-muted-foreground">{i + 1}</span>
                    <span className="num font-semibold">{s.outletId}</span>
                    <span className="text-[12px] text-muted-foreground">stop {s.seq}</span>
                    <span className="num ml-auto">{kg(s.kg)}</span>
                  </li>
                ))}
              </ol>
              <div className="flex flex-wrap gap-1.5 border-t p-3">
                {trips.slice(0, 12).map((tr) => (
                  <Link
                    key={tr.id}
                    href={`/dispatch/publish?trip=${tr.id}`}
                    className={cn("num rounded-md border px-1.5 py-0.5 text-[12px]", tr.id === preview.id && "border-foreground")}
                    scroll={false}
                  >
                    {tr.code}
                  </Link>
                ))}
              </div>
            </Panel>
          )}
          <p className="text-[13px] text-muted-foreground">
            {live && !published ? `Replaces published v${live.version}. ` : ""}Changes after publishing go only to the roles they affect, as an update with the reason.
          </p>
          {!cutoffPassed && !published && (
            <p className="rounded-md border border-late-risk-border bg-late-risk-bg p-3 text-[13px] text-late-risk">
              Orders are still open until 16:00. Publishing now is allowed, but orders placed before the cutoff will need a re-plan.
            </p>
          )}
          {published ? (
            <Button asChild size="field" data-tour="publish">
              <Link href="/dispatch/live">
                <Send /> Published · watch live operations
              </Link>
            </Button>
          ) : (
            <ActionButton action={publishAction} fields={{ planId: plan.id }} size="field" disabled={blocked} data-tour="publish">
              <Send /> {blocked ? (undecided ? `Decide ${undecided} deferral(s) first` : "Fix rule violations first") : `Publish plan v${plan.version}`}
            </ActionButton>
          )}
          <Button asChild size="desk" variant="outline" className="w-full" data-tour="print">
            <Link href={`/dispatch/print/${plan.id}`} target="_blank">
              <Printer /> Print backup run sheets
            </Link>
          </Button>
        </aside>
      </main>
    </>
  );
}
