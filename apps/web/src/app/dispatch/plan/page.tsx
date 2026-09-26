import type { Metadata } from "next";
import { Play } from "lucide-react";
import { ActionButton } from "@/components/wp/action-button";
import { Panel } from "@/components/wp/panel";
import { dayLabel } from "@/lib/format";
import { loadReference } from "@waypoint/db";
import { db } from "@/lib/server/db";
import { currentPlan, loadPlanningInput } from "@/lib/server/planning";
import { planView } from "@/lib/server/queries/plan-view";
import { runs } from "@/lib/server/runs";
import { DispatchHeader } from "../_components/header";
import { autoPlanAction } from "../actions";
import { currentDepot } from "../depot";
import { PlanningBoard, type BoardData } from "./board";

export const metadata: Metadata = { title: "D-03 Planning board" };

export default async function PlanningBoardPage() {
  const depot = await currentDepot();
  const { planning } = await runs();
  const plan = await currentPlan(depot, planning);
  const badge = plan ? (
    <span className="rounded-md border px-2 py-0.5 text-[12px] font-semibold">
      {plan.status === "published" ? "Published" : "Draft"} {plan.version}
    </span>
  ) : null;

  if (!plan) {
    return (
      <>
        <DispatchHeader title="Planning board" context={`${depot} · run for ${dayLabel(planning, true)}`} depot={depot} />
        <main className="p-6">
          <Panel className="flex flex-wrap items-center justify-between gap-4 p-6">
            <div>
              <h2 className="font-semibold">No plan for {dayLabel(planning)} yet</h2>
              <p className="text-sm text-muted-foreground">Run the planner, then adjust it here by dragging orders between trips.</p>
            </div>
            <ActionButton action={autoPlanAction} fields={{ depot }} size="desk">
              <Play /> Run auto-plan
            </ActionButton>
          </Panel>
        </main>
      </>
    );
  }

  const [input, view, refInput] = await Promise.all([loadPlanningInput(depot, planning), planView(plan.id), loadReference(db())]);
  const outletsHere = new Set(input.orders.map((o) => o.outletId));
  const data: BoardData = {
    planId: plan.id,
    planStatus: plan.status as "draft" | "published",
    version: plan.version,
    depot,
    runDate: planning,
    ref: {
      outlets: refInput.outlets.filter((o) => o.depot === depot || outletsHere.has(o.id)),
      vehicles: refInput.vehicles.filter((v) => v.depot === depot),
      districts: refInput.districts,
      allowance: refInput.allowance,
      speed: refInput.speed.filter((s) => refInput.districts.some((d) => d.name === s.district && d.depot === depot)),
    },
    ctx: input.ctx,
    status: input.status,
    fuelUsed: input.fuelUsed,
    orders: input.orders.map((o) => ({
      ref: o.ref,
      outletId: o.outletId,
      temp: o.temp,
      units: o.units,
      kg: o.kg,
      m3: o.m3,
      deferredYesterday: o.deferredYesterday,
      daysSinceLastServed: o.daysSinceLastServed,
    })),
    trips: view.trips.map((tr) => ({
      id: tr.id,
      code: tr.code,
      vehicleId: tr.vehicleId,
      tripNo: tr.tripNo,
      status: tr.status,
      departureMin: tr.departureMin,
      orderIds: tr.stops.map((s) => s.orderId),
      arrivals: Object.fromEntries(tr.stops.map((s) => [s.orderId, s.plannedArrive ?? 0])),
      lateRisk: tr.stops.filter((s) => s.lateRisk).map((s) => s.orderId),
    })),
    deferrals: view.deferrals.map((d) => ({
      orderId: d.orderId,
      kind: d.kind,
      reasonCode: d.reasonCode,
      explanation: d.explanation,
      lostToOrderId: d.lostToOrderId,
    })),
  };

  return (
    <>
      <DispatchHeader
        title="Planning board"
        context={
          <span className="inline-flex items-center gap-2">
            {depot} · run for {dayLabel(planning, true)} {badge}
          </span>
        }
        depot={depot}
      />
      <PlanningBoard data={data} rerun={<ActionButton key="rerun" action={autoPlanAction} fields={{ depot }} size="desk" variant="secondary" confirm={plan.status === "published" ? "Re-planning creates a new draft. The published plan stays live until you publish again. Continue?" : undefined}>Re-run auto-plan</ActionButton>} />
    </>
  );
}
