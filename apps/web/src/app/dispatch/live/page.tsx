import { ChevronDown, GitMerge, MessageSquare, SkipForward } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/wp/action-button";
import { StatusPill, TempTag, type StatusKind } from "@/components/wp/chips";
import { RealtimeRefresh } from "@/components/wp/realtime";
import { Kpi, Panel, PanelHeader } from "@/components/wp/panel";
import { PromptAction } from "@/components/wp/prompt-action";
import { colombo, dayLabel, hhmm } from "@/lib/format";
import { nextOperatingDay } from "@waypoint/planner";
import { LATE_MARGIN, liveBoard, type LiveException, type LiveStop, type LiveTrip, type TripLabel } from "@/lib/server/live";
import { reference } from "@/lib/server/reference";
import { cn } from "@/lib/utils";
import { DispatchHeader } from "../_components/header";
import { currentDepot } from "../depot";
import {
  closeExceptionAction,
  decideShortfallAction,
  deferStopAction,
  markHandledAction,
  messageDriverAction,
  replyStoreAction,
  warnStoreAction,
  warnTripStoresAction,
} from "./actions";

export const metadata: Metadata = { title: "D-06 Live operations" };

const PILL: Record<TripLabel, StatusKind> = {
  Complete: "delivered",
  "Held at dock": "exception",
  "Not departed": "exception",
  "Long stop": "exception",
  "Late risk": "late-risk",
  "At stop": "en-route",
  "En route": "en-route",
  Ready: "loading",
  Loading: "loading",
  Planned: "planned",
};

export default async function LivePage() {
  const depot = await currentDepot();
  const board = await liveBoard(depot);
  if (!board) {
    return (
      <>
        <DispatchHeader title="Live operations" depot={depot} />
        <main className="p-6">
          <Panel className="p-6 text-sm text-muted-foreground">
            No published plan to follow yet for {depot}. Publish one in{" "}
            <Link href="/dispatch/publish" className="underline">
              D-05
            </Link>
            .
          </Panel>
        </main>
      </>
    );
  }
  const { plan, clock, nowMin, trips, exceptions, kpi, openConflicts } = board;
  const next = nextOperatingDay(await reference(), plan.runDate);
  const nextLabel = dayLabel(next).split(" ")[0]!;
  const quiet = trips.filter((x) => x.rank >= 3);
  const shown = trips.filter((x) => x.rank < 3);

  return (
    <>
      <RealtimeRefresh channels={["ops"]} />
      <DispatchHeader
        title="Live operations"
        context={
          <>
            {depot} · Plan v{plan.version} · {dayLabel(plan.runDate, true)}
          </>
        }
        depot={depot}
        actions={
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-delivered opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-delivered" />
            </span>
            Live · updates as drivers record stops
          </span>
        }
      />
      <main className="space-y-5 p-6">
        {nowMin === null && (
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            The run starts {dayLabel(plan.runDate)} - it is {dayLabel(clock.date)} {hhmm(clock.minute)} now, so nothing can be late yet. Move the clock on the{" "}
            <Link href="/demo" className="underline">
              demo panel
            </Link>{" "}
            to watch the run.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Trips departed" value={`${kpi.departed} / ${kpi.trips}`} />
          <Kpi label="Stops delivered" value={`${kpi.delivered} / ${kpi.stops}`} />
          <Kpi label="Late risk" value={`${kpi.riskStops} stops`} sub={`${kpi.riskTrips} trips · under ${LATE_MARGIN} min to window close`} tone={kpi.riskStops ? "late-risk" : undefined} />
          <Kpi label="Needs action" value={exceptions.filter((e) => e.kind !== "late_risk").length} tone={exceptions.length ? "violation" : undefined} />
        </div>

        {openConflicts > 0 && (
          <Link href="/dispatch/live/conflicts" className="flex items-center gap-3 rounded-lg border border-conflict-border bg-conflict-bg p-4 text-conflict">
            <GitMerge className="size-5" />
            <span className="flex-1 font-medium">
              {openConflicts} conflict{openConflicts === 1 ? "" : "s"} after a vehicle came back online - decide in reconciliation
            </span>
            <span className="text-sm underline">Open DG-02</span>
          </Link>
        )}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Panel className="overflow-hidden">
            <div className="grid grid-cols-[minmax(120px,1fr)_84px_88px_118px_minmax(160px,1.6fr)_48px_minmax(104px,1fr)_16px] gap-3 border-b px-4 py-2 text-[13px] text-muted-foreground max-lg:hidden">
              <span>Trip · vehicle</span>
              <span>District</span>
              <span>Progress</span>
              <span>Status</span>
              <span>Next stop · ETA · late-risk stops</span>
              <span className="text-right">Drift</span>
              <span>Last event</span>
              <span />
            </div>
            {shown.map((tr) => (
              <TripRow key={tr.id} trip={tr} />
            ))}
            {quiet.length > 0 && (
              <details className="group border-t">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm text-muted-foreground hover:bg-muted/40">
                  <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
                  {quiet.length} more trip{quiet.length === 1 ? "" : "s"}: {quiet.filter((x) => x.label !== "Complete").length} not yet running,{" "}
                  {quiet.filter((x) => x.label === "Complete").length} complete
                </summary>
                {quiet.map((tr) => (
                  <TripRow key={tr.id} trip={tr} />
                ))}
              </details>
            )}
            <p className="border-t px-4 py-3 text-[13px] text-muted-foreground">
              ETA = planned arrival + the drift seen so far on that trip (re-timed from each recorded stop). Late risk = under {LATE_MARGIN} min before the
              window closes. The Datathon lateness model replaces the drift rule when its forecast is loaded.
            </p>
          </Panel>

          <Panel className="h-fit">
            <PanelHeader title="Exceptions" aside="Only what needs a person" />
            <ul className="divide-y">
              {exceptions.map((e) => (
                <li key={e.key} className="space-y-2 p-4">
                  <ExceptionCard e={e} nextLabel={nextLabel} />
                </li>
              ))}
              {exceptions.length === 0 && <li className="p-4 text-sm text-muted-foreground">Nothing needs you right now.</li>}
            </ul>
          </Panel>
        </div>
      </main>
    </>
  );
}

function TripRow({ trip: tr }: { trip: LiveTrip }) {
  const risk = tr.riskStops.filter((s) => s.id !== tr.next?.id);
  return (
    <details className="group border-b last:border-0">
      <summary className="grid cursor-pointer list-none grid-cols-[minmax(120px,1fr)_84px_88px_118px_minmax(160px,1.6fr)_48px_minmax(104px,1fr)_16px] items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/40 max-lg:grid-cols-2">
        <span className="num min-w-0">
          <span className="block font-medium">{tr.code}</span>
          <span className="block text-[13px] text-muted-foreground">
            {tr.vehicleId}
            {tr.tripNo > 1 ? ` · trip ${tr.tripNo}` : ""}
          </span>
        </span>
        <span>{tr.district}</span>
        <span className="flex items-center gap-2">
          <span className="num">
            {tr.delivered}/{tr.total}
          </span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <span className="block h-full bg-delivered" style={{ width: `${tr.total ? (tr.delivered / tr.total) * 100 : 0}%` }} />
          </span>
        </span>
        <span>
          <StatusPill status={PILL[tr.label]}>{tr.label}</StatusPill>
        </span>
        <span className="num min-w-0 text-[13px]">
          {tr.next ? (
            <>
              <span className={cn(tr.next.risk && "font-semibold text-late-risk")}>
                {tr.next.outletId} {tr.next.status === "arrived" ? "at stop" : hhmm(tr.next.eta)}
              </span>
              {risk.length > 0 && (
                <span className="text-late-risk">
                  {" "}
                  · {risk.length} stop{risk.length === 1 ? "" : "s"} ·{" "}
                  {risk
                    .slice(0, 2)
                    .map((s) => `${s.outletId} ${hhmm(s.eta)}`)
                    .join(", ")}
                  {risk.length > 2 ? ` +${risk.length - 2} more` : ""}
                </span>
              )}
            </>
          ) : tr.label === "Complete" ? (
            "All stops done"
          ) : (
            `dep ${hhmm(tr.departureMin)}`
          )}
        </span>
        <span className={cn("num text-right", (tr.drift ?? 0) >= LATE_MARGIN && "text-late-risk")}>
          {tr.drift === null ? "—" : `${tr.drift > 0 ? "+" : ""}${tr.drift}`}
        </span>
        <span className="num text-[13px] text-muted-foreground">{tr.lastEvent}</span>
        <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="bg-muted/30 px-4 py-3">
        <ol className="grid gap-1.5 text-sm">
          {tr.stops.map((s) => (
            <StopLine key={s.id} s={s} />
          ))}
        </ol>
        <div className="mt-3 flex flex-wrap gap-2">
          <PromptAction
            action={messageDriverAction}
            fields={{ tripId: tr.id }}
            title={`Message ${tr.vehicleId}'s driver`}
            description="Shows on the driver's phone at the next sync."
            placeholder="e.g. Call OUT027 before you leave - they need the crates stacked inside."
            size="sm"
            variant="outline"
          >
            <MessageSquare /> Message driver
          </PromptAction>
          {tr.stops.some((s) => s.status === "planned") && tr.departedMin !== null && (
            <ActionButton action={warnTripStoresAction} fields={{ tripId: tr.id }} size="sm" variant="outline">
              Send new ETAs to {tr.stops.filter((s) => s.status === "planned").length} stores
            </ActionButton>
          )}
        </div>
      </div>
    </details>
  );
}

function StopLine({ s }: { s: LiveStop }) {
  const state =
    s.status === "delivered"
      ? `delivered ${hhmm(s.arrivedMin)}–${hhmm(s.leftMin)}${s.arrivedMin !== null && s.arrivedMin > s.close ? " · late" : ""}`
      : s.status === "arrived"
        ? `at stop since ${hhmm(s.arrivedMin)}`
        : s.status === "skipped"
          ? "moved to the next run"
          : s.status === "exception"
            ? `not delivered · ${hhmm(s.leftMin)}`
            : `ETA ${hhmm(s.eta)} · ${s.margin !== null ? (s.margin >= 0 ? `${s.margin} min to spare` : `${-s.margin} min after close`) : ""}`;
  return (
    <li className={cn("grid grid-cols-[2rem_5.5rem_5rem_1fr] items-center gap-2", s.status === "skipped" && "opacity-60")}>
      <span className="num text-muted-foreground">{s.seq}</span>
      <span className="num font-medium">{s.outletId}</span>
      <TempTag temp={s.temp} />
      <span className={cn("num text-[13px]", s.risk && "text-late-risk")}>
        {state} <span className="text-muted-foreground">· window closes {hhmm(s.close)} · planned {hhmm(s.plannedArrive)}</span>
      </span>
    </li>
  );
}

function ExceptionCard({ e, nextLabel }: { e: LiveException; nextLabel: string }) {
  const head = (kind: StatusKind, label: string, when?: string) => (
    <div className="flex items-center justify-between gap-2">
      <StatusPill status={kind}>{label}</StatusPill>
      {when && <span className="num text-[13px] text-muted-foreground">{when}</span>}
    </div>
  );
  switch (e.kind) {
    case "shortfall":
      return (
        <>
          {head("exception", "Dock shortfall")}
          <p className="font-medium">
            {e.trip.vehicleId} · {e.outletId} is {e.units} unit{e.units === 1 ? "" : "s"} {e.shortKind}
          </p>
          <p className="text-[13px] text-muted-foreground">
            {e.trip.code} · order {e.orderId}
            {e.note ? ` · “${e.note}”` : ""}
          </p>
          {e.photoKey && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/files/${e.photoKey}`} alt="Shortfall photo" className="h-20 rounded border object-cover" />
          )}
          <div className="flex flex-wrap gap-2">
            <ActionButton action={decideShortfallAction} fields={{ shortfallId: e.id, decision: "HOLD" }} size="sm" variant="outline">
              Hold until complete
            </ActionButton>
            <ActionButton action={decideShortfallAction} fields={{ shortfallId: e.id, decision: "SEND_AND_WARN" }} size="sm">
              Send and warn store
            </ActionButton>
          </div>
        </>
      );
    case "stop_exception":
      return (
        <>
          {head("exception", "Not delivered", hhmm(e.atMin))}
          <p className="font-medium">
            {e.trip.vehicleId} at {e.stop.outletId}: {e.type.replaceAll("_", " ")}
          </p>
          {e.note && <p className="text-[13px] text-muted-foreground">“{e.note}”</p>}
          {e.photoKey && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/files/${e.photoKey}`} alt="Driver's photo" className="h-20 rounded border object-cover" />
          )}
          <div className="flex flex-wrap gap-2">
            <ActionButton action={closeExceptionAction} fields={{ exceptionId: e.id, outcome: "next_run" }} size="sm">
              Re-deliver first on {nextLabel}
            </ActionButton>
            <ActionButton action={closeExceptionAction} fields={{ exceptionId: e.id, outcome: "closed" }} size="sm" variant="outline">
              Close
            </ActionButton>
          </div>
        </>
      );
    case "not_departed":
      return (
        <>
          {head("exception", "Not departed", `${e.late} min late`)}
          <p className="font-medium">
            {e.trip.vehicleId} hasn&apos;t left for {e.trip.code}
          </p>
          <p className="text-[13px] text-muted-foreground">
            Planned {hhmm(e.trip.departureMin)}. {e.trip.total} {e.trip.district} stops; last window closes {hhmm(Math.max(...e.trip.stops.map((s) => s.close)))}.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href="/dispatch/publish">Check dock sign-off</Link>
            </Button>
            <PromptAction action={messageDriverAction} fields={{ tripId: e.trip.id }} title={`Message ${e.trip.vehicleId}'s driver`} size="sm" variant="outline" placeholder="Are you loaded? You were due out at …">
              Message driver
            </PromptAction>
          </div>
        </>
      );
    case "long_stop":
      return (
        <>
          {head("exception", "Long stop", `since ${hhmm(e.stop.arrivedMin)}`)}
          <p className="font-medium">
            {e.trip.vehicleId} at {e.stop.outletId} for {e.minutes} min
          </p>
          <p className="text-[13px] text-muted-foreground">
            Allowance is {e.stop.allowance} min ({e.stop.brand}). {e.trip.code} still has {e.trip.stops.filter((s) => s.status === "planned").length} stops in {e.trip.district}.
          </p>
          <div className="flex flex-wrap gap-2">
            <ActionButton action={warnTripStoresAction} fields={{ tripId: e.trip.id }} size="sm">
              Send new ETAs to {e.trip.stops.filter((s) => s.status === "planned").length} stores
            </ActionButton>
            <PromptAction action={messageDriverAction} fields={{ tripId: e.trip.id }} title={`Message ${e.trip.vehicleId}'s driver`} size="sm" variant="outline" placeholder="What is holding you at …?">
              Message driver
            </PromptAction>
          </div>
        </>
      );
    case "late_risk": {
      const worstStop = e.stops.reduce((a, b) => ((a.margin ?? 0) <= (b.margin ?? 0) ? a : b));
      return (
        <>
          {head("late-risk", `Late risk · ${e.stops.length} stop${e.stops.length === 1 ? "" : "s"}`, `running ${e.trip.drift ?? 0} min behind`)}
          <p className="num font-medium">
            {e.trip.code} · {e.trip.vehicleId} · {e.trip.district}
          </p>
          <ul className="space-y-1.5">
            {e.stops.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                <span className={cn("num min-w-0 flex-1", s.id === worstStop.id && "font-semibold")}>
                  {s.outletId} {hhmm(s.eta)} ·{" "}
                  <span className="text-late-risk">{s.margin !== null && s.margin < 0 ? `${-s.margin} min past ${hhmm(s.close)}` : `${s.margin} min before ${hhmm(s.close)}`}</span>
                </span>
                {s.warned ? (
                  <span className="text-muted-foreground">warned</span>
                ) : (
                  <ActionButton action={warnStoreAction} fields={{ stopId: s.id }} size="sm" variant="outline" className="h-7 px-2 text-xs">
                    Warn
                  </ActionButton>
                )}
                {s.status === "planned" && (
                  <PromptAction
                    action={deferStopAction}
                    fields={{ stopId: s.id }}
                    name="reason"
                    required={false}
                    title={`Move ${s.outletId} to ${nextLabel}?`}
                    description={`The stop comes off ${e.trip.code}; the goods ride back and go first on ${nextLabel}'s run. The store and the driver are told now. If the driver is offline, their phone gets the change when it reconnects.`}
                    placeholder="Reason for the store (optional)"
                    submitLabel={`Defer to ${nextLabel}`}
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                  >
                    <SkipForward /> {nextLabel}
                  </PromptAction>
                )}
              </li>
            ))}
          </ul>
        </>
      );
    }
    case "receipt":
      return (
        <>
          {head("exception", "Store reports a problem")}
          <p className="font-medium">
            {e.outletId} received {e.received} of {e.units} units
          </p>
          <p className="text-[13px] text-muted-foreground">
            {e.orderId}
            {e.issues ? ` · ${e.issues}` : ""}
            {e.note ? ` · “${e.note}”` : ""}
          </p>
          {e.photoKey && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/files/${e.photoKey}`} alt="Store's photo" className="h-20 rounded border object-cover" />
          )}
          <div className="flex flex-wrap gap-2">
            <PromptAction
              action={replyStoreAction}
              fields={{ orderId: e.orderId }}
              title={`Reply to ${e.outletId}`}
              placeholder="The missing units go on tomorrow's run at no charge."
              size="sm"
            >
              Reply to store
            </PromptAction>
            <ActionButton action={markHandledAction} fields={{ kind: "receipt", id: e.orderId }} size="sm" variant="outline">
              Mark handled
            </ActionButton>
          </div>
        </>
      );
    case "message":
      return (
        <>
          {head("planned", "Message", colombo(e.at))}
          <p className="font-medium">
            {e.outletId} about {e.orderId}
          </p>
          <p className="text-sm">“{e.body}”</p>
          <div className="flex flex-wrap gap-2">
            <PromptAction action={replyStoreAction} fields={{ orderId: e.orderId }} title={`Reply to ${e.outletId}`} size="sm">
              Reply
            </PromptAction>
            <ActionButton action={markHandledAction} fields={{ kind: "message", id: e.id }} size="sm" variant="outline">
              Mark handled
            </ActionButton>
          </div>
        </>
      );
  }
}
