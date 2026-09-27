import { Check, Circle, CircleDashed, SkipForward } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/wp/action-button";
import { TempTag } from "@/components/wp/chips";
import { Panel, PanelHeader } from "@/components/wp/panel";
import { colombo, dayLabel, hhmm, kg, m3 } from "@/lib/format";
import { requireUser } from "@/lib/server/session";
import { outletInfo, stageOf, storeOrders } from "@/lib/server/store";
import { cn } from "@/lib/utils";
import { ackNoticeAction } from "../../actions";
import { MessageDispatcher } from "../../message-dispatcher";
import { StagePill } from "../../stage-pill";

export const metadata: Metadata = { title: "SM-03 Order tracking" };

const STAGES = ["placed", "confirmed", "planned", "loaded", "en_route", "delivered"] as const;

export default async function OrderPage({ params }: PageProps<"/store/orders/[id]">) {
  const user = await requireUser(["store_manager"]);
  const { id } = await params;
  const outlet = (await outletInfo(user.outletId!))!;
  const all = await storeOrders(outlet.id, "2000-01-01", "2100-01-01");
  const o = all.find((x) => x.id === id);
  if (!o) notFound();
  const stage = stageOf(o);
  const siblings = all.filter((x) => (x.runDate === o.runDate && x.id !== o.id) || (o.deferral && x.requestedDate === o.requestedDate && x.id !== o.id));

  if (stage === "deferred" && o.deferral) {
    // SM-04 deferral notice
    const sib = siblings.find((x) => x.requestedDate === o.requestedDate);
    return (
      <main className="mx-auto max-w-2xl space-y-4">
        <Panel className="space-y-4 p-6">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-deferred-border bg-deferred-bg px-2.5 text-[13px] font-semibold text-deferred">
              <SkipForward className="size-3.5" /> Deferred
            </span>
            <TempTag temp={o.temp} />
            <span className="text-[13px] text-muted-foreground">{o.deferral.publishedAt ? `${colombo(o.deferral.publishedAt)}` : ""}</span>
          </div>
          <h1 className="text-2xl font-semibold">
            Your {o.temp === "chilled" ? "chilled" : "dry"} order moves to {o.deferral.newRunDate ? dayLabel(o.deferral.newRunDate) : "the next run"}
          </h1>
          <p className="num text-sm text-muted-foreground">
            {o.id} · {kg(o.weightKg)} · {m3(o.volumeM3, 3)}
          </p>
          <dl className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border p-3">
              <dt className="text-[13px] text-muted-foreground">New delivery</dt>
              <dd className="font-semibold">{o.deferral.newRunDate ? dayLabel(o.deferral.newRunDate) : "Next run"}</dd>
              <dd className="text-[13px] text-muted-foreground">
                Same window, {hhmm(outlet.windowOpen)}–{hhmm(outlet.windowClose)}
              </dd>
            </div>
            <div className="rounded-lg border p-3">
              <dt className="text-[13px] text-muted-foreground">Priority</dt>
              <dd className="font-semibold">Guaranteed</dd>
              <dd className="text-[13px] text-muted-foreground">Placed on the next plan before new orders</dd>
            </div>
            <div className="rounded-lg border p-3">
              <dt className="text-[13px] text-muted-foreground">Your other order</dt>
              <dd className="font-semibold">{sib ? (stageOf(sib) === "deferred" ? "Also moved" : "Not affected") : "—"}</dd>
              <dd className="text-[13px] text-muted-foreground">{sib?.stop ? `${dayLabel(sib.runDate)}, planned ${hhmm(sib.stop.plannedArrive)}` : ""}</dd>
            </div>
          </dl>
          <section>
            <h2 className="font-semibold">Why</h2>
            <p className="text-sm">{o.deferral.explanation}</p>
            <p className="mt-2 text-[13px] text-muted-foreground">
              Recorded as{" "}
              {o.deferral.kind === "UNAVOIDABLE"
                ? "unavoidable - no vehicle could legally carry it"
                : o.deferral.kind === "CAPACITY_FORCED"
                  ? "a capacity limit"
                  : "a dispatcher decision"}
              . No need to reorder.
            </p>
          </section>
          <div className="flex flex-wrap gap-2">
            <ActionButton action={ackNoticeAction} fields={{ orderId: o.id }} size="desk">
              Got it
            </ActionButton>
            <MessageDispatcher orderId={o.id} />
          </div>
        </Panel>
      </main>
    );
  }

  // SM-03 tracking
  const idx = STAGES.indexOf(stage as (typeof STAGES)[number]);
  const s = o.stop;
  const rows: Array<{
    k: (typeof STAGES)[number];
    title: string;
    sub: string;
    at: string;
  }> = [
    {
      k: "placed",
      title: "Placed",
      sub: `${o.temp === "chilled" ? "Chilled" : "Dry"} order${o.source === "app" ? " from this app" : ""}`,
      at: o.receivedAt ? colombo(o.receivedAt) : "—",
    },
    {
      k: "confirmed",
      title: "Confirmed",
      sub: o.intakeReason === "ON_TIME" ? "Received before the 16:00 cutoff" : `Moved: ${o.intakeReason.replaceAll("_", " ").toLowerCase()}`,
      at: o.receivedAt ? colombo(o.receivedAt) : "—",
    },
    {
      k: "planned",
      title: "Planned",
      sub: s ? `${s.tripCode} · ${s.vehicleId} · stop ${s.seq} · planned ${hhmm(s.plannedArrive)}` : "Waiting for the plan (published the evening before)",
      at: s?.publishedAt ? colombo(s.publishedAt) : "—",
    },
    {
      k: "loaded",
      title: "Loaded",
      sub: "Loader signed off the load list at the dock",
      at: o.signedOff ? "done" : "—",
    },
    {
      k: "en_route",
      title: "En route",
      sub: s?.departedMin ? `Left the depot ${hhmm(s.departedMin)}` : "Not left yet",
      at: s?.departedMin ? hhmm(s.departedMin) : "—",
    },
    {
      k: "delivered",
      title: "Delivered",
      sub: s?.status === "delivered" ? `Arrived ${hhmm(s.arrivedMin)}, handed over ${hhmm(s.leftMin)}` : "The driver records it; you confirm what arrived",
      at: s?.leftMin ? hhmm(s.leftMin) : "—",
    },
  ];
  const eta = s ? (s.status === "delivered" ? s.arrivedMin : (s.etaMin ?? s.plannedArrive)) : null;
  return (
    <main className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Panel>
        <PanelHeader title={`${o.temp === "chilled" ? "Chilled" : "Dry"} order ${o.id}`} aside={<StagePill order={o} />} />
        <p className="num px-4 pt-3 text-sm text-muted-foreground">
          {o.units} units · {kg(o.weightKg)} · {m3(o.volumeM3, 3)} · for {dayLabel(o.runDate)}
        </p>
        <ol className="space-y-4 p-4">
          {rows.map((r, i) => (
            <li key={r.k} className="flex gap-3">
              {i < idx || (i === idx && stage === "delivered") ? (
                <Check className="mt-0.5 size-5 shrink-0" />
              ) : i === idx ? (
                <Circle className="mt-0.5 size-5 shrink-0 fill-foreground" />
              ) : (
                <CircleDashed className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              )}
              <div className="flex-1">
                <p className={cn("font-medium", i > idx && "text-muted-foreground")}>{r.title}</p>
                <p className="text-[13px] text-muted-foreground">{r.sub}</p>
              </div>
              <span className="num text-[13px] text-muted-foreground">{r.at}</span>
            </li>
          ))}
        </ol>
      </Panel>
      <aside className="space-y-4">
        {s && (
          <Panel className="space-y-2 p-4">
            <p className="text-sm text-muted-foreground">
              {s.status === "delivered" ? "Arrived at" : stage === "en_route" && s.seq ? "Expected around" : "Planned arrival"}
            </p>
            <p className={cn("num text-5xl font-semibold", s.lateRisk && s.status !== "delivered" && "text-late-risk")}>{hhmm(eta)}</p>
            {s.status !== "delivered" && eta !== null && (
              <p className="text-sm">
                {Math.round(outlet.windowClose - eta) >= 0
                  ? `${Math.round(outlet.windowClose - eta)} min before your ${hhmm(outlet.windowClose)} window closes.`
                  : `After your ${hhmm(outlet.windowClose)} window closes - the dispatcher is watching it.`}
              </p>
            )}
            <h3 className="pt-2 text-sm font-semibold">How the time changed</h3>
            <ul className="num space-y-1 text-[13px]">
              <li className="flex justify-between">
                <span>Plan published</span>
                <span>{hhmm(s.plannedArrive)}</span>
              </li>
              {s.etaMin !== null && Math.round(s.etaMin) !== Math.round(s.plannedArrive ?? 0) && (
                <li className="flex justify-between">
                  <span>{s.departedMin ? "Updated from the driver's records" : "Expected with traffic and roads"}</span>
                  <span>{hhmm(s.etaMin)}</span>
                </li>
              )}
            </ul>
            <p className="text-[12px] text-muted-foreground">
              Times update each time the driver records a stop. If the truck can&apos;t make your window, you&apos;ll see a warning here first.
            </p>
          </Panel>
        )}
        {stage === "delivered" && (
          <Button asChild size="desk" className="w-full">
            <Link href={`/store/receive/${o.id}`}>{o.receipt ? "View receipt" : "Confirm what arrived"}</Link>
          </Button>
        )}
        <MessageDispatcher orderId={o.id} />
      </aside>
    </main>
  );
}
