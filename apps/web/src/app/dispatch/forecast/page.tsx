import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton } from "@/components/wp/action-button";
import { Kpi, Panel, PanelHeader } from "@/components/wp/panel";
import { colombo, dayLabel } from "@/lib/format";
import { forecastView } from "@/lib/server/forecast";
import { cn } from "@/lib/utils";
import { DispatchHeader } from "../_components/header";
import { currentDepot } from "../depot";
import { DemandChart } from "./demand-chart";
import { clearForecastAction } from "./actions";
import { ForecastUpload } from "./upload";

export const metadata: Metadata = { title: "D-07 Capacity forecast" };

export default async function ForecastPage({ searchParams }: PageProps<"/dispatch/forecast">) {
  const depot = await currentDepot();
  const sp = await searchParams;
  const want = sp.src === "baseline" || sp.src === "datathon" ? sp.src : undefined;
  const f = await forecastView(depot, want);
  const n = (v: number, d = 0) => v.toLocaleString("en-GB", { maximumFractionDigits: d, minimumFractionDigits: d });

  const rows = f.weeks.map((w) => {
    const orders = f.chilledOrderM3 ? w.chilled / f.chilledOrderM3 : null;
    const need = orders !== null ? Math.ceil(orders / f.perTrip.value) : null;
    return { ...w, orders, need, gap: need !== null ? f.supply.reeferTripsPerWeek - need : null };
  });
  const worst = rows.filter((r) => r.gap !== null).sort((a, b) => a.gap! - b.gap!)[0];
  const range = f.weeks.length ? `ISO weeks ${f.weeks[0]!.isoYear}-W${f.weeks[0]!.isoWeek} → W${f.weeks[f.weeks.length - 1]!.isoWeek}` : "no forecast loaded";

  return (
    <>
      <DispatchHeader title="Capacity forecast" context={`${range} · operating days Mon–Sat`} depot={depot} actions={<ForecastUpload variant="outline" />} />
      <main className="space-y-5 p-6">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Demand source</span>
          {(["datathon", "baseline"] as const).map((s) => (
            <Link
              key={s}
              href={`/dispatch/forecast?src=${s}`}
              aria-disabled={!f.sources.includes(s)}
              className={cn(
                "rounded-md border px-2.5 py-1",
                f.source === s ? "border-foreground font-medium" : "text-muted-foreground",
                !f.sources.includes(s) && "pointer-events-none opacity-50",
              )}
            >
              {s === "datathon" ? "Datathon Task 2A" : "Seasonal-naive baseline"}
            </Link>
          ))}
          {f.uploadedAt && <span className="text-[13px] text-muted-foreground">loaded {colombo(f.uploadedAt)}</span>}
          {f.sources.includes("datathon") && (
            <ActionButton action={clearForecastAction} variant="ghost" size="sm" confirm="Remove the uploaded Datathon forecast for both depots?" className="ml-auto">
              Remove Datathon forecast
            </ActionButton>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi
            label="Tightest reefer week"
            value={worst ? (worst.gap! >= 0 ? `+${worst.gap} trips` : `${worst.gap} trips`) : "—"}
            sub={worst ? `W${worst.isoWeek}: ${worst.need} needed of ${f.supply.reeferTripsPerWeek} available` : "Load a forecast to see the gap"}
            tone={worst && worst.gap! < 0 ? "violation" : worst && worst.gap! < f.supply.reeferTripsPerWeek * 0.1 ? "late-risk" : undefined}
          />
          <Kpi label="Reefer trips / week" value={f.supply.reeferTripsPerWeek} sub={`${f.supply.reefers} reefers × ${2} trips × 6 days`} />
          <Kpi
            label="Chilled orders per reefer trip"
            value={n(f.perTrip.value, 1)}
            sub={f.perTrip.basis === "plan" ? `${f.perTrip.orders} chilled on ${f.perTrip.trips} reefer trips, ${dayLabel(f.perTrip.runDate!)}` : "Booklet reference day, 23 Dec"}
          />
          <Kpi label="Average chilled order" value={f.chilledOrderM3 ? `${n(f.chilledOrderM3, 2)} m³` : "—"} sub={`${depot} order history`} />
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <Panel>
            <PanelHeader title="Weekly volume by brand" aside={f.source === "datathon" ? "Datathon Task 2A" : f.source === "baseline" ? "baseline · same week last year × growth" : undefined} />
            <div className="p-4">
              {f.weeks.length ? (
                <DemandChart weeks={f.weeks.map((w) => ({ label: `W${w.isoWeek}`, Fresh: w.total.Fresh, Style: w.total.Style, Tech: w.total.Tech, chilled: w.chilled }))} />
              ) : (
                <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-6">
                  <p className="font-medium">Waiting for the demand forecast</p>
                  <p className="text-sm text-muted-foreground">
                    Datathon Task 2A: 60 values (2 depots × 3 brands × 10 weeks), trained on deliveries_train and task1_test_inputs.
                  </p>
                  <ForecastUpload />
                </div>
              )}
            </div>
          </Panel>

          <Panel>
            <PanelHeader title={`Supply per week · ${depot}`} aside="vehicles.csv" />
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-3 p-4 text-sm">
              <dt>
                Reefers
                <span className="block text-[13px] text-muted-foreground">
                  {f.supply.reeferTrucks} trucks + {f.supply.reeferVans} vans · {f.supply.reeferTripsPerWeek} trips/wk
                </span>
              </dt>
              <dd className="num text-2xl font-semibold">{f.supply.reefers}</dd>
              <dt>
                Reefer Fresh minutes
                <span className="block text-[13px] text-muted-foreground">{f.supply.reefers} × 270 × 6 days</span>
              </dt>
              <dd className="num text-2xl font-semibold">{n(f.supply.freshMinutes)}</dd>
              <dt>
                Vans (van_only outlets)
                <span className="block text-[13px] text-muted-foreground">
                  {f.supply.reeferVansCount} reefer + {f.supply.vans - f.supply.reeferVansCount} ambient
                </span>
              </dt>
              <dd className="num text-2xl font-semibold">{f.supply.vans}</dd>
              <dt>
                Weekly fuel quota
                <span className="block text-[13px] text-muted-foreground">
                  {f.supply.fleet} vehicles · {depot === "Peliyagoda" ? "Kandy" : "Peliyagoda"} {n(f.supply.otherQuota)} L
                </span>
              </dt>
              <dd className="num text-2xl font-semibold">{n(f.supply.quota)} L</dd>
            </dl>
          </Panel>
        </div>

        <Panel className="overflow-hidden">
          <PanelHeader title="Reefer trips needed per week" aside={`need = forecast chilled orders ÷ ${n(f.perTrip.value, 1)} per reefer trip`} />
          <div className="overflow-x-auto">
            <table className="num w-full text-sm">
              <thead className="text-left text-[13px] text-muted-foreground">
                <tr className="border-b">
                  <th className="px-4 py-2 font-medium">Week</th>
                  <th className="px-3 py-2 text-right font-medium">Chilled m³</th>
                  <th className="px-3 py-2 text-right font-medium">Chilled orders</th>
                  <th className="px-3 py-2 text-right font-medium">Reefer trips needed</th>
                  <th className="px-3 py-2 text-right font-medium">Available</th>
                  <th className="px-4 py-2 text-right font-medium">Gap</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.isoYear}-${r.isoWeek}`} className="border-b last:border-0">
                    <td className="px-4 py-2">
                      {r.isoYear}-W{String(r.isoWeek).padStart(2, "0")}
                    </td>
                    <td className="px-3 py-2 text-right">{n(r.chilled, 1)}</td>
                    <td className="px-3 py-2 text-right">{r.orders !== null ? n(r.orders) : "—"}</td>
                    <td className="px-3 py-2 text-right">{r.need ?? "—"}</td>
                    <td className="px-3 py-2 text-right">{f.supply.reeferTripsPerWeek}</td>
                    <td className={cn("px-4 py-2 text-right font-medium", r.gap !== null && r.gap < 0 && "text-violation", r.gap !== null && r.gap >= 0 && r.gap < 11 && "text-late-risk")}>
                      {r.gap === null ? "—" : r.gap >= 0 ? `+${r.gap}` : r.gap}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                      No forecast yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHeader title="Service time per stop" aside="observed = left − later of arrival and window open" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[13px] text-muted-foreground">
                <tr className="border-b">
                  <th className="px-4 py-2 font-medium">Outlet</th>
                  <th className="px-3 py-2 font-medium">Dock</th>
                  <th className="px-3 py-2 text-right font-medium">Units</th>
                  <th className="px-3 py-2 text-right font-medium">Allowance</th>
                  <th className="px-3 py-2 text-right font-medium">Observed</th>
                  <th className="px-4 py-2 font-medium">Predicted</th>
                </tr>
              </thead>
              <tbody>
                {f.service.map((s) => (
                  <tr key={`${s.code}-${s.outletId}`} className="border-b last:border-0">
                    <td className="num px-4 py-2">
                      {s.outletId} <span className="text-muted-foreground">· {s.code}</span>
                    </td>
                    <td className="px-3 py-2">{s.dock.replace("_", " ")}</td>
                    <td className="num px-3 py-2 text-right">{s.units}</td>
                    <td className="num px-3 py-2 text-right">{s.allowance} min</td>
                    <td className={cn("num px-3 py-2 text-right", s.ratio >= 2 && "font-medium text-late-risk")}>{s.observed} min</td>
                    <td className="px-4 py-2 text-[13px] text-muted-foreground">Task 1 model</td>
                  </tr>
                ))}
                {f.service.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                      No delivered stops on the current run yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {f.service[0] && f.service[0].ratio >= 1.5 && (
            <p className="border-t px-4 py-3 text-[13px] text-muted-foreground">
              {f.service[0].outletId} took {f.service[0].observed} min against a {f.service[0].allowance}-min allowance, {n(f.service[0].ratio, 1)} times longer.
              Predicted service time (Datathon Task 1) replaces the flat allowance in trip minutes and ETAs.
            </p>
          )}
        </Panel>
      </main>
    </>
  );
}
