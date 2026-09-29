import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Kpi, Panel } from "@/components/wp/panel";
import { dayLabel, kg } from "@/lib/format";
import { boardData } from "@/lib/server/board-data";
import { currentPlan } from "@/lib/server/planning";
import { runs } from "@/lib/server/runs";
import { DispatchHeader } from "../_components/header";
import { currentDepot } from "../depot";
import { Board } from "../plan/board-logic";
import { DeferralReview, type ReviewRow } from "./review";

export const metadata: Metadata = { title: "D-04 Deferral review" };

export default async function DeferralReviewPage() {
  const depot = await currentDepot();
  const { planning } = await runs();
  const plan = await currentPlan(depot, planning);
  if (!plan) {
    return (
      <>
        <DispatchHeader title="Deferral review" context={`${depot} · run for ${dayLabel(planning, true)}`} depot={depot} />
        <main className="p-6">
          <Panel className="p-6">
            <p className="font-semibold">No plan yet</p>
            <p className="text-sm text-muted-foreground">
              Run auto-plan on the <Link href="/dispatch" className="underline">control tower</Link> first.
            </p>
          </Panel>
        </main>
      </>
    );
  }

  const { data, view } = await boardData(plan);
  const board = new Board(data);
  const stopByOrder = new Map(view.trips.flatMap((tr) => tr.stops.map((s) => [s.orderId, { trip: tr, stop: s }] as const)));

  // a deferral whose order cannot be loaded is left out rather than failing the whole review
  const rows: ReviewRow[] = view.deferrals.filter((d) => board.orders.has(d.orderId)).map((d) => {
    const o = board.orders.get(d.orderId)!;
    const slots = board.legalSlots(d.orderId, 3).map((s) => {
      const day = board.propose(d.orderId, s);
      return { ...s, preview: board.preview(d.orderId, s.vehicleId, day) };
    });
    let swap: ReviewRow["swap"] = null;
    if (d.lostToOrderId && stopByOrder.has(d.lostToOrderId) && board.orders.has(d.lostToOrderId)) {
      const verdict = board.checkSwap(d.orderId, d.lostToOrderId);
      const p = board.proposeSwap(d.orderId, d.lostToOrderId);
      const lost = board.orders.get(d.lostToOrderId)!;
      swap = {
        outOrderId: d.lostToOrderId,
        outOutletId: lost.outletId,
        outWhy: lost.deferredYesterday ? "skipped yesterday" : lost.temp === "chilled" ? "perishable" : `waited ${lost.daysSinceLastServed} days`,
        ok: verdict.ok,
        why: verdict.ok ? null : verdict.detail,
        vehicleId: verdict.vehicleId,
        preview: p && verdict.ok ? board.preview(d.orderId, p.vehicleId, p.day) : null,
      };
    }
    const sibling = [...stopByOrder.values()].find((x) => x.stop.outletId === o.outletId && x.stop.orderId !== d.orderId);
    return {
      orderId: d.orderId,
      outletId: o.outletId,
      district: o.outlet.district,
      dock: o.outlet.dock,
      brand: o.outlet.brand,
      temp: o.temp,
      kg: o.kg,
      m3: o.m3,
      open: o.outlet.open,
      close: o.outlet.close,
      kind: d.kind,
      reasonCode: d.reasonCode,
      explanation: d.explanation,
      decided: !!d.decidedAt,
      newRunDate: d.newRunDate,
      deferredYesterday: (d.fairness as { deferredYesterday?: number } | null)?.deferredYesterday ?? o.deferredYesterday,
      daysSinceLastServed: o.daysSinceLastServed,
      slots,
      swap,
      sibling: sibling
        ? { orderId: sibling.stop.orderId, tripCode: sibling.trip.code, vehicleId: sibling.trip.vehicleId, arrive: sibling.stop.plannedArrive ?? null, temp: sibling.stop.temp }
        : null,
    };
  });

  const unavoidable = rows.filter((r) => r.kind === "UNAVOIDABLE");
  rows.sort((a, b) => b.deferredYesterday - a.deferredYesterday);
  const chosen = rows.filter((r) => r.kind === "CHOSEN");
  const repeats = rows.filter((r) => r.deferredYesterday > 0);
  const needs = rows.filter((r) => r.kind === "CHOSEN" || r.deferredYesterday > 0);
  const decided = needs.filter((r) => r.decided);
  const totalKg = rows.reduce((s, r) => s + r.kg, 0);

  return (
    <>
      <DispatchHeader
        title="Deferral review"
        context={`${depot} · run for ${dayLabel(planning, true)} · ${plan.status === "published" ? "Published" : "Draft"} ${plan.version}`}
        depot={depot}
      />
      <main className="space-y-5 p-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Kpi
            label="Skipped twice in a row"
            value={repeats.length}
            tone={repeats.length ? "violation" : undefined}
            sub={repeats.length ? "Top priority and still no slot · record why" : "No outlet misses a second run"}
          />
          <Kpi label="Deferred" value={rows.length} tone={rows.length ? "deferred" : undefined} sub={`${rows.filter((r) => r.temp === "chilled").length} chilled · ${kg(totalKg)}`} />
          <Kpi label="Unavoidable" value={unavoidable.length} sub="No legal slot · reason filled in" />
          <Kpi label="Chosen" value={chosen.length} sub="Lost to a higher-priority order · you decide" />
          <Kpi
            label="Decided"
            value={`${decided.length} / ${needs.length}`}
            tone={decided.length < needs.length ? "late-risk" : undefined}
            sub={decided.length < needs.length ? `Publishing is blocked until ${needs.length} of ${needs.length}` : "Ready to publish"}
          />
        </div>
        <DeferralReview planId={plan.id} rows={rows} />
        <div className="flex flex-wrap items-center justify-end gap-3">
          <p className="mr-auto text-[13px] text-muted-foreground">
            Checked against rules 1–7, delivery windows and fuel at planned times. Capacity deferrals had no legal slot on any vehicle; unavoidable ones had no
            eligible vehicle at all.
          </p>
          <Button asChild size="desk" variant={decided.length < needs.length ? "outline" : "default"}>
            <Link href="/dispatch/publish">
              Continue to publish{decided.length < needs.length ? ` · ${needs.length - decided.length} undecided` : ""}
            </Link>
          </Button>
        </div>
      </main>
    </>
  );
}
