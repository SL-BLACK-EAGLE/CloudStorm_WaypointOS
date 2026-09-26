import { Lock, LockOpen, Snowflake } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/wp/chips";
import { Panel } from "@/components/wp/panel";
import { and, eq, inArray } from "@waypoint/db/orm";
import { dayLabel, int, kg, m3 } from "@/lib/format";
import { db, t } from "@/lib/server/db";
import { currentPlan } from "@/lib/server/planning";
import { planView, queue } from "@/lib/server/queries/plan-view";
import { runs } from "@/lib/server/runs";
import { reference } from "@/lib/server/reference";
import { nextOperatingDay } from "@waypoint/planner";
import { DispatchHeader } from "../_components/header";
import { currentDepot } from "../depot";
import { QueueTable, type QueueItem } from "./queue-table";

export const metadata: Metadata = { title: "D-02 Order queue" };

export default async function OrderQueuePage() {
  const depot = await currentDepot();
  const { planning, cutoffPassed, clock } = await runs();
  const R = await reference();
  const nextRun = nextOperatingDay(R, planning);
  const [rows, plan, late] = await Promise.all([
    queue(depot, planning),
    currentPlan(depot, planning),
    db()
      .select({ id: t.orders.id, outletId: t.orders.outletId, brand: t.orders.brand, temp: t.orders.temp, kg: t.orders.weightKg, receivedAt: t.orders.receivedAt })
      .from(t.orders)
      .where(and(eq(t.orders.depotId, depot), eq(t.orders.runDate, nextRun), eq(t.orders.intakeReason, "AFTER_CUTOFF"), inArray(t.orders.status, ["confirmed"]))),
  ]);
  const view = plan ? await planView(plan.id) : null;
  const where = new Map<string, string>();
  for (const tr of view?.trips ?? []) for (const s of tr.stops) where.set(s.orderId, `${tr.vehicleId} · trip ${tr.tripNo}`);
  const deferred = new Set((view?.deferrals ?? []).map((d) => d.orderId));

  const items: QueueItem[] = rows.map((r) => ({
    ...r,
    receivedAt: r.receivedAt?.toISOString() ?? null,
    planState: deferred.has(r.id) ? "deferred" : where.has(r.id) ? "planned" : "confirmed",
    planWhere: where.get(r.id) ?? null,
  }));
  const tally = {
    chilled: rows.filter((r) => r.temp === "chilled").length,
    ambientFresh: rows.filter((r) => r.temp === "ambient" && r.brand === "Fresh").length,
    vanOnly: rows.filter((r) => r.parking === "van_only").length,
    mall: rows.filter((r) => r.parking === "mall_dock").length,
    style: rows.filter((r) => r.brand === "Style").length,
    tech: rows.filter((r) => r.brand === "Tech").length,
  };
  const techRows = rows.filter((r) => r.brand === "Tech");
  const totalKg = rows.reduce((s, r) => s + r.kg, 0);
  const totalM3 = rows.reduce((s, r) => s + r.m3, 0);

  return (
    <>
      <DispatchHeader title="Order queue" context={`${depot} · run for ${dayLabel(planning, true)}`} depot={depot} />
      <div className="grid xl:grid-cols-[minmax(0,1fr)_340px]">
        <main className="min-w-0 space-y-4 p-6">
          <div className="flex items-start gap-3 rounded-lg border bg-card p-4 text-sm">
            {cutoffPassed ? <Lock className="mt-0.5 size-4 shrink-0" aria-hidden /> : <LockOpen className="mt-0.5 size-4 shrink-0" aria-hidden />}
            <p>
              {cutoffPassed ? (
                <>
                  <strong>Closed at 16:00, {dayLabel(clock.date)}.</strong> {rows.length} orders are confirmed for {dayLabel(planning)}.
                  Orders received after the cutoff wait for the {dayLabel(nextRun)} run and are listed separately.
                </>
              ) : (
                <>
                  <strong>Open until 16:00 today.</strong> {rows.length} orders confirmed for {dayLabel(planning)} so far. Stores can still
                  add orders; after 16:00 new orders go to the {dayLabel(nextRun)} run.
                </>
              )}
            </p>
          </div>
          <QueueTable items={items} />
          {late.length > 0 && (
            <Panel className="p-4">
              <h2 className="text-sm font-semibold">
                Received after the cutoff · for {dayLabel(nextRun)} ({late.length})
              </h2>
              <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
                {late.map((o) => (
                  <li key={o.id} className="flex items-center gap-2">
                    <BrandMark brand={o.brand} size={16} />
                    <span className="num">{o.id}</span>
                    <span className="num text-muted-foreground">{o.outletId}</span>
                    {o.temp === "chilled" && <Snowflake className="size-3.5 text-chilled" aria-label="chilled" />}
                    <span className="num ml-auto text-muted-foreground">{kg(o.kg)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </main>
        <aside className="flex flex-col gap-4 border-l bg-card/40 p-6 xl:sticky xl:top-16 xl:h-[calc(100dvh-4rem)]">
          <div>
            <p className="text-[13px] text-muted-foreground">Queue for {dayLabel(planning)}</p>
            <p className="num text-3xl font-semibold">{int(rows.length)} orders</p>
            <p className="num text-[13px] text-muted-foreground">
              {kg(totalKg)} · {m3(totalM3)}
            </p>
          </div>
          <div>
            <h2 className="num mb-2 text-[12px] tracking-widest text-muted-foreground uppercase">What the orders require</h2>
            <dl className="space-y-2 text-sm">
              {[
                [<span key="r" className="flex items-center gap-2"><Snowflake className="size-4 text-chilled" /> Reefer (chilled)</span>, tally.chilled],
                ["Any vehicle (ambient Fresh)", tally.ambientFresh],
                ["Van (van_only outlets)", tally.vanOnly],
                ["Mall window", tally.mall],
                [<span key="s" className="flex items-center gap-2"><BrandMark brand="Style" size={16} /> Style (480-min budget)</span>, tally.style],
                [<span key="t" className="flex items-center gap-2"><BrandMark brand="Tech" size={16} /> Tech (480-min budget)</span>, tally.tech],
              ].map(([label, n], i) => (
                <div key={i} className="flex items-center justify-between gap-3">
                  <dt>{label}</dt>
                  <dd className="num font-semibold">{n}</dd>
                </div>
              ))}
            </dl>
          </div>
          {techRows.length > 0 && (
            <p className="text-[13px] text-muted-foreground">
              Tech orders {techRows.map((r) => `${r.outletId} (${r.district}, ${kg(r.kg)})`).join(" and ")} deliver in the daytime window under the
              separate 480-min budget.
            </p>
          )}
          <div className="mt-auto space-y-2">
            <Button asChild size="desk" variant="secondary" className="w-full">
              <Link href="/dispatch/plan">Open planning board</Link>
            </Button>
            <p className="text-center text-[12px] text-muted-foreground">Auto-plan checks rules 1–7, delivery windows and fuel</p>
          </div>
        </aside>
      </div>
    </>
  );
}
