import { PageTour } from "@/components/wp/tour";
import { FLEET_TOUR } from "@/lib/tours/dispatcher";
import { Snowflake, Wrench } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton } from "@/components/wp/action-button";
import { Meter } from "@/components/wp/meter";
import { Kpi, Panel } from "@/components/wp/panel";
import { PromptAction } from "@/components/wp/prompt-action";
import { dayLabel, hhmm, int } from "@/lib/format";
import { fleetView } from "@/lib/server/fleet";
import { cn } from "@/lib/utils";
import { DispatchHeader } from "../_components/header";
import { currentDepot } from "../depot";
import { vehicleStatusAction } from "./actions";

export const metadata: Metadata = { title: "Fleet" };

/** Fleet: availability for the run being planned (workshop), fuel against weekly quota, and trips. */
export default async function FleetPage() {
  const depot = await currentDepot();
  const f = await fleetView(depot);
  const workshop = f.vehicles.filter((v) => v.status === "in_workshop");
  const reefers = f.vehicles.filter((v) => v.temp === "reefer");
  const quota = f.vehicles.reduce((n, v) => n + v.weeklyFuelQuotaL, 0);
  const used = f.vehicles.reduce((n, v) => n + v.fuelUsed, 0);
  const planned = f.vehicles.reduce((n, v) => n + v.plannedLitres, 0);
  const stale = workshop.filter((v) => v.planned.length > 0);

  return (
    <>
      <PageTour id="fleet" steps={FLEET_TOUR} />
      <DispatchHeader title="Fleet" context={`${depot} · availability for ${dayLabel(f.planning, true)}`} depot={depot} />
      <main className="space-y-5 p-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-tour="kpis">
          <Kpi label="Vehicles" value={f.vehicles.length} sub={`${reefers.length} reefers · ${f.vehicles.filter((v) => v.type === "van").length} vans`} />
          <Kpi label="In the workshop" value={workshop.length} sub={workshop.map((v) => v.id).join(", ") || "none"} tone={workshop.length ? "deferred" : undefined} />
          <Kpi label="Available reefers" value={reefers.length - workshop.filter((v) => v.temp === "reefer").length} sub={`of ${reefers.length}`} />
          <Kpi
            label={`Fuel this ISO week${f.week ? ` (W${f.week.isoWeek})` : ""}`}
            value={`${int(used + planned)} L`}
            sub={`${int(used)} used + ${int(planned)} on the draft · quota ${int(quota)} L`}
            tone={used + planned > quota * 0.95 ? "late-risk" : undefined}
          />
        </div>

        {stale.length > 0 && (
          <p className="rounded-lg border border-deferred-border bg-deferred-bg p-3 text-sm text-deferred">
            {stale.map((v) => v.id).join(", ")} {stale.length === 1 ? "is" : "are"} in the workshop but still {stale.length === 1 ? "has" : "have"} trips on the draft for{" "}
            {dayLabel(f.planning)}. Re-run auto-plan on the{" "}
            <Link href="/dispatch/plan" className="underline">
              planning board
            </Link>
            .
          </p>
        )}

        <Panel className="overflow-hidden" data-tour="fleet-table">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[13px] text-muted-foreground">
                <tr className="border-b">
                  <th className="px-4 py-2 font-medium">Vehicle</th>
                  <th className="px-3 py-2 font-medium">Capacity</th>
                  <th className="px-3 py-2 font-medium">{dayLabel(f.planning).split(" ")[0]} trips (draft)</th>
                  <th className="px-3 py-2 font-medium">Running now</th>
                  <th className="w-56 px-3 py-2 font-medium" data-tour="fuel">Fuel this week</th>
                  <th className="px-4 py-2 text-right font-medium" data-tour="workshop">{dayLabel(f.planning)}</th>
                </tr>
              </thead>
              <tbody>
                {f.vehicles.map((v) => (
                  <tr key={v.id} className={cn("border-b last:border-0", v.status === "in_workshop" && "bg-muted/40")}>
                    <td className="px-4 py-2.5">
                      <p className="num flex items-center gap-1.5 font-medium">
                        {v.id}
                        {v.temp === "reefer" && <Snowflake className="size-3.5 text-chilled" aria-label="reefer" />}
                      </p>
                      <p className="text-[13px] text-muted-foreground">
                        {v.temp} {v.type}
                      </p>
                    </td>
                    <td className="num px-3 py-2.5 text-[13px]">
                      {int(v.weightCapKg)} kg · {v.volumeCapM3} m³
                      <span className="block text-muted-foreground">{v.kmPerL} km/L</span>
                    </td>
                    <td className="num px-3 py-2.5 text-[13px]">
                      {v.planned.length ? v.planned.map((x) => `${x.code} ${x.district} ${hhmm(x.departureMin)}`).join(", ") : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="num px-3 py-2.5 text-[13px]">
                      {v.today.length ? v.today.map((x) => `${x.code} · ${x.status.replace("_", " ")}`).join(", ") : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <Meter used={v.fuelUsed + v.plannedLitres} total={v.weeklyFuelQuotaL} valueLabel={`${int(v.fuelUsed + v.plannedLitres)} / ${int(v.weeklyFuelQuotaL)} L`} />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {v.status === "in_workshop" ? (
                        <div className="flex items-center justify-end gap-2">
                          <span className="flex items-center gap-1 text-[13px] text-deferred">
                            <Wrench className="size-3.5" /> Workshop{v.note ? ` · ${v.note}` : ""}
                          </span>
                          <ActionButton action={vehicleStatusAction} fields={{ vehicleId: v.id, status: "available" }} size="sm" variant="outline">
                            Back in service
                          </ActionButton>
                        </div>
                      ) : (
                        <PromptAction
                          action={vehicleStatusAction}
                          fields={{ vehicleId: v.id, status: "in_workshop" }}
                          required={false}
                          title={`${v.id} to the workshop for ${dayLabel(f.planning)}?`}
                          description="The planner will not give it trips. If the draft already uses it, re-run auto-plan."
                          placeholder="Reason (optional), e.g. brake service"
                          submitLabel="Send to workshop"
                          size="sm"
                          variant="ghost"
                        >
                          <Wrench /> Workshop
                        </PromptAction>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </main>
    </>
  );
}
