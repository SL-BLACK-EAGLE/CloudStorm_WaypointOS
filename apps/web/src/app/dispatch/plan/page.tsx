import type { Metadata } from "next";
import { Play } from "lucide-react";
import { ActionButton } from "@/components/wp/action-button";
import { Panel } from "@/components/wp/panel";
import { dayLabel } from "@/lib/format";
import { boardData } from "@/lib/server/board-data";
import { currentPlan } from "@/lib/server/planning";
import { runs } from "@/lib/server/runs";
import { DispatchHeader } from "../_components/header";
import { autoPlanAction } from "../actions";
import { currentDepot } from "../depot";
import { PlanningBoard } from "./board";
import { OptimizerNote } from "./optimizer-note";

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

  const { data } = await boardData(plan);

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
      <OptimizerNote metrics={plan.metrics} />
      <PlanningBoard data={data} rerun={<ActionButton key="rerun" action={autoPlanAction} fields={{ depot }} size="desk" variant="secondary" confirm={plan.status === "published" ? "Re-planning creates a new draft. The published plan stays live until you publish again. Continue?" : undefined}>Re-run auto-plan</ActionButton>} />
    </>
  );
}
