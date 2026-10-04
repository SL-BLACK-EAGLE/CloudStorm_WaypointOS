import { ArrowRight, RotateCcw, SkipForward } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { StatusPill, TempTag } from "@/components/wp/chips";
import { Panel, PanelHeader } from "@/components/wp/panel";
import { DOCK_LABEL, dayLabel, duration, hhmm, kg, m3 } from "@/lib/format";
import { CUTOFF_MIN } from "@/lib/time-rules";
import { db, t } from "@/lib/server/db";
import { runs } from "@/lib/server/runs";
import { requireUser } from "@/lib/server/session";
import { pendingStoreAsk } from "@/lib/server/live";
import { orderingRun, outletInfo, stageOf, storeOrders, type StoreOrder } from "@/lib/server/store";
import { and, eq } from "@waypoint/db/orm";
import { cn } from "@/lib/utils";
import { PageTour } from "@/components/wp/tour";
import { HOME_TOUR } from "@/lib/tours/store";
import { StagePill } from "./stage-pill";

export const metadata: Metadata = { title: "SM-01 Home" };

export default async function StoreHome() {
  const user = await requireUser(["store_manager"]);
  const outlet = (await outletInfo(user.outletId!))!;
  const { active, clock } = await runs();
  const ordering = await orderingRun();
  const activeOrders = await storeOrders(outlet.id, active, active);
  // Once today's run is settled (all delivered or moved), the store's next delivery is the next run.
  const settled = activeOrders.every((o) => ["delivered", "deferred"].includes(stageOf(o)));
  const day = settled && active === clock.date ? ordering.requested : active;
  const today = day === active ? activeOrders : await storeOrders(outlet.id, day, day);
  const earlier = day === active ? [] : activeOrders;
  const upcoming = ordering.runDate !== day ? await storeOrders(outlet.id, ordering.runDate, ordering.runDate) : [];
  const [allowance] = await db()
    .select()
    .from(t.serviceAllowances)
    .where(and(eq(t.serviceAllowances.brand, outlet.brand), eq(t.serviceAllowances.dockType, outlet.dockType)));
  // A skipped stop belongs to the run the order was moved off, so it is not this run's delivery.
  const onRun = (o: StoreOrder) => !!o.stop && o.stop.status !== "skipped";
  const next = today.find((o) => onRun(o) && o.stop!.status !== "delivered") ?? today.find(onRun);
  const deferredToday = today.filter((o) => stageOf(o) === "deferred");
  // DG-03: any moved order the dispatcher has offered back for today
  const asks = (await Promise.all([...activeOrders, ...today].filter((o, i, a) => a.findIndex((x) => x.id === o.id) === i).map(async (o) => ({ o, ask: await pendingStoreAsk(o.id) })))).filter((x) => x.ask);
  const minsToCutoff = clock.date < ordering.requested ? CUTOFF_MIN - clock.minute : 0;

  return (
    <main className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <PageTour id="sm01" steps={HOME_TOUR} />
      <Panel className="p-5" data-tour="next-delivery">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">Next delivery · {dayLabel(day)}</h2>
          {next && <StagePill order={next} />}
        </div>
        {next?.stop ? (
          <NextDelivery
            o={next}
            close={outlet.windowClose}
            allowance={allowance?.minutes ?? null}
            dock={DOCK_LABEL[outlet.dockType]}
            now={clock.date === day ? clock.minute : null}
          />
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            {today.length
              ? "Your orders for this run are not on a published plan yet. The plan is published the evening before."
              : day === ordering.runDate && !ordering.afterCutoff
                ? `No orders for ${dayLabel(day)} yet. Place them before 16:00 to get a delivery.`
                : `No delivery for ${dayLabel(day)}.`}
          </p>
        )}
      </Panel>

      <Panel className="flex flex-col gap-3 p-5" data-tour="cutoff">
        <h2 className="font-semibold">Order cutoff</h2>
        <p className="text-sm">
          Orders for <strong>{dayLabel(ordering.runDate)}</strong> close at <strong className="num">16:00</strong>
          {ordering.afterCutoff ? " - the cutoff for the next run has passed." : " today."}
        </p>
        {minsToCutoff > 0 && !ordering.afterCutoff && <p className="num text-4xl font-semibold">{duration(minsToCutoff)}</p>}
        <p className="text-[13px] text-muted-foreground">
          Orders placed after 16:00 go to the following run.
          {outlet.brand === "Fresh" ? " Dry and chilled are separate orders." : ""}
        </p>
        {upcoming.length > 0 && (
          <p className="text-[13px]">
            You have {upcoming.length} order{upcoming.length === 1 ? "" : "s"} for {dayLabel(ordering.runDate)} already.
          </p>
        )}
        <Button asChild size="desk" className="mt-auto">
          <Link href="/store/order">
            Place {dayLabel(ordering.runDate).split(" ")[0]}&apos;s orders <ArrowRight />
          </Link>
        </Button>
      </Panel>

      {asks.map(({ o, ask }) => (
        <Link key={`ask-${o.id}`} data-tour="ask" href={`/store/orders/${o.id}`} className="flex items-center gap-3 rounded-lg border border-conflict-border bg-conflict-bg p-4 text-conflict lg:col-span-2">
          <RotateCcw className="size-5 shrink-0" />
          <span className="flex-1">
            <strong>Your {o.temp === "chilled" ? "chilled" : "dry"} order can come today after all</strong>
            <span className="block text-sm">
              Arrives about {hhmm(ask!.ask.eta)}
              {ask!.ask.eta > ask!.close ? ", after your window" : ""} · the driver is waiting for your answer
            </span>
          </span>
          <ArrowRight className="size-4" />
        </Link>
      ))}
      {deferredToday.map((o) => (
        <Link
          key={o.id}
          data-tour="moved"
          href={`/store/orders/${o.id}`}
          className="flex items-center gap-3 rounded-lg border border-deferred-border bg-deferred-bg p-4 text-deferred lg:col-span-2"
        >
          <SkipForward className="size-5 shrink-0" />
          <span className="flex-1">
            <strong>
              {o.temp === "chilled" ? "Chilled" : "Dry"} order moved to {o.deferral?.newRunDate ? dayLabel(o.deferral.newRunDate) : "the next run"}
            </strong>
            <span className="block text-sm">Priority on that run · see why</span>
          </span>
          <ArrowRight className="size-4" />
        </Link>
      ))}

      <div className="min-w-0 lg:col-span-2" data-tour="orders">
        <OrdersTable title={`Orders · ${dayLabel(day)}`} orders={today} />
      </div>
      {earlier.length > 0 && <OrdersTable title={`Earlier today · ${dayLabel(active)}`} orders={earlier} />}
      {upcoming.length > 0 && <OrdersTable title={`Orders · ${dayLabel(ordering.runDate)}`} orders={upcoming} />}
    </main>
  );
}

function NextDelivery({ o, close, allowance, dock, now }: { o: StoreOrder; close: number; allowance: number | null; dock: string; now: number | null }) {
  const s = o.stop!;
  const delivered = s.status === "delivered";
  const eta = delivered ? (s.arrivedMin ?? s.etaMin) : (s.etaMin ?? s.plannedArrive);
  const drift = eta !== null && s.plannedArrive !== null ? Math.round(eta - s.plannedArrive) : 0;
  const spare = eta !== null ? Math.round(close - eta) : null;
  return (
    <div className="mt-3 grid gap-5 sm:grid-cols-[auto_1fr]">
      <div>
        <p className="text-sm text-muted-foreground">{delivered ? "Arrived at" : "Expected around"}</p>
        <p className={cn("num text-6xl font-semibold tracking-tight", s.lateRisk && !delivered && "text-late-risk")}>{hhmm(eta)}</p>
      </div>
      <dl className="grid grid-cols-[6.5rem_1fr] gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Planned</dt>
        <dd className="num">
          {hhmm(s.plannedArrive)}
          {!delivered && drift !== 0 && (
            <span className="text-muted-foreground">
              {" "}
              · running {Math.abs(drift)} min {drift > 0 ? "behind" : "ahead"}
            </span>
          )}
        </dd>
        <dt className="text-muted-foreground">Your window</dt>
        <dd className="num">
          closes {hhmm(close)}
          {spare !== null && !delivered && (
            <span className={cn(spare < 20 ? "text-late-risk" : "text-muted-foreground")}>
              {" "}
              · {spare >= 0 ? `${spare} min to spare` : `${-spare} min after close`}
            </span>
          )}
        </dd>
        <dt className="text-muted-foreground">Unloading</dt>
        <dd>
          at the {dock}
          {allowance ? `, about ${allowance} min` : ""}
        </dd>
        <dt className="text-muted-foreground">Order</dt>
        <dd className="num">
          {o.id} · {o.units} units · {kg(o.weightKg)}
        </dd>
        <dt className="text-muted-foreground">Vehicle</dt>
        <dd className="num">
          {s.vehicleId} · {s.tripCode} · {s.seq - 1 === 0 ? "you are the first stop" : `${s.seq - 1} stop${s.seq === 2 ? "" : "s"} before you`}
        </dd>
      </dl>
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <Button asChild size="desk">
          <Link href={`/store/orders/${o.id}`}>Track delivery</Link>
        </Button>
        <Button asChild size="desk" variant="outline">
          <Link href={`/store/receive/${o.id}`}>{delivered ? "Confirm what arrived" : "Receive when it arrives"}</Link>
        </Button>
        {now !== null && !delivered && <span className="self-center text-[13px] text-muted-foreground">Now {hhmm(now)}</span>}
      </div>
    </div>
  );
}

function OrdersTable({ title, orders }: { title: string; orders: StoreOrder[] }) {
  return (
    <Panel className="overflow-hidden lg:col-span-2">
      <PanelHeader title={title} aside={orders[0]?.receivedAt ? `Placed before the 16:00 cutoff` : undefined} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-[13px] text-muted-foreground">
            <tr className="border-b">
              <th className="px-4 py-2 font-medium">Order</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 text-right font-medium">Weight</th>
              <th className="px-3 py-2 text-right font-medium">Volume</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const stage = stageOf(o);
              return (
                <tr key={o.id} className="border-b last:border-0">
                  <td className="num px-4 py-2">
                    <Link href={`/store/orders/${o.id}`} className="font-medium underline-offset-4 hover:underline">
                      {o.id}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <TempTag temp={o.temp} />
                  </td>
                  <td className="num px-3 py-2 text-right">{kg(o.weightKg)}</td>
                  <td className="num px-3 py-2 text-right">{m3(o.volumeM3, 3)}</td>
                  <td className="px-3 py-2">
                    <StagePill order={o} />
                  </td>
                  <td className="px-4 py-2 text-[13px]">
                    {stage === "deferred"
                      ? `${o.deferral?.newRunDate ? dayLabel(o.deferral.newRunDate) : "Next run"} · priority`
                      : stage === "delivered"
                        ? o.receipt
                          ? `Received ${o.receipt.status === "problem" ? "with a problem" : "in full"}`
                          : "Delivered · confirm receipt"
                        : o.stop
                          ? `around ${hhmm(o.stop.etaMin ?? o.stop.plannedArrive)}`
                          : "Waiting for the plan"}
                  </td>
                </tr>
              );
            })}
            {orders.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                  No orders.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
