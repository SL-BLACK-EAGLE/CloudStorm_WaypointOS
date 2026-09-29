"use client";

import {
  ArrowLeft,
  Camera,
  Check,
  CircleCheck,
  CloudOff,
  GitMerge,
  Loader2,
  MapPin,
  Minus,
  Navigation,
  Plus,
  RefreshCw,
  Snowflake,
  TriangleAlert,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { BrandMark, StatusPill } from "@/components/wp/chips";
import { DOCK_LABEL, dayLabel, hhmm } from "@/lib/format";
import { downscale } from "@/lib/image";
import { clockNow } from "@/lib/offline/clock";
import type { OutboxRow } from "@/lib/offline/db";
import type { PackStop, PackTrip, RunPack } from "@/lib/offline/types";
import { useDriver } from "@/lib/offline/use-driver";
import { cn } from "@/lib/utils";
import { SignaturePad, type SignatureHandle } from "./signature-pad";
import { ackDriverNoticeAction, canDeliverAction } from "./actions";

type View = { name: "run" } | { name: "stop"; stopId: string } | { name: "deliver"; stopId: string } | { name: "exception"; stopId: string } | { name: "outbox" };

function readHash(): View {
  if (typeof window === "undefined") return { name: "run" };
  const [name, id] = window.location.hash.replace(/^#/, "").split("/");
  if ((name === "stop" || name === "deliver" || name === "exception") && id) return { name, stopId: id };
  if (name === "outbox") return { name: "outbox" };
  return { name: "run" };
}

/** DR-01..DR-05 + DG-01: one offline-capable app; views live in the URL hash so no network is needed to move between them. */
export function DriveApp({ serverPack }: { serverPack: RunPack | null }) {
  const d = useDriver(serverPack);
  const [view, setView] = useState<View>({ name: "run" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setView(readHash());
    const on = () => setView(readHash());
    window.addEventListener("hashchange", on);
    const t = setInterval(() => setTick((x) => x + 1), 15_000);
    return () => {
      window.removeEventListener("hashchange", on);
      clearInterval(t);
    };
  }, []);
  const go = (v: View) => {
    const h = v.name === "run" ? "" : v.name === "outbox" ? "outbox" : `${v.name}/${v.stopId}`;
    history.pushState(null, "", h ? `#${h}` : window.location.pathname);
    setView(v);
    window.scrollTo(0, 0);
  };

  const pack = d.pack;
  const now = useMemo(() => (pack ? clockNow(pack.clock) : null), [pack, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!pack) return <EmptyState text="Opening your run…" />;
  if (!pack.vehicle) return <EmptyState text="No vehicle is assigned to you yet. Ask the dispatcher to assign one." />;
  if (!pack.trips.length) return <EmptyState text={`No trips for ${pack.vehicle.id} on ${dayLabel(pack.runDate)} yet. The run appears here as soon as the dispatcher publishes the plan.`} onRefresh={d.refresh} />;

  const allStops = pack.trips.flatMap((t) => t.stops.map((s) => ({ ...s, trip: t })));
  const findStop = (id: string) => allStops.find((s) => s.stopId === id);
  // moved stops stay on screen until the dispatcher has settled them (DG-02), not only right after the change arrives
  const settled = new Set(pack.conflicts.filter((c) => c.status === "resolved").map((c) => c.stopId));
  const waiting = pack.conflicts.filter((c) => c.status === "open" && c.kind === "DRIVER_CAN_DELIVER").map((c) => c.stopId!);
  const changed = [...new Map([...d.changes.filter((s) => !settled.has(s.stopId)), ...allStops.filter((s) => s.status === "skipped" && !settled.has(s.stopId))].map((s) => [s.stopId, s])).values()];

  return (
    <div className="mx-auto min-h-dvh max-w-md pb-6">
      <TopBar pack={pack} online={d.online} queued={d.queued} onOutbox={() => go({ name: "outbox" })} />
      {view.name === "run" && <Notices notices={pack.notices ?? []} online={d.online} />}
      {changed.length > 0 && view.name === "run" && <PlanChanged stops={changed} online={d.online} waiting={waiting} />}
      {view.name === "run" && <RunView pack={pack} now={now!.minute} online={d.online} onOpen={(s) => go({ name: "stop", stopId: s })} record={d.record} />}
      {view.name === "stop" && findStop(view.stopId) && (
        <NextStopView stop={findStop(view.stopId)!} trip={findStop(view.stopId)!.trip} now={now!.minute} onBack={() => go({ name: "run" })} onArrive={() => go({ name: "deliver", stopId: view.stopId })} onProblem={() => go({ name: "exception", stopId: view.stopId })} record={d.record} />
      )}
      {view.name === "deliver" && findStop(view.stopId) && (
        <DeliverView
          stop={findStop(view.stopId)!}
          trip={findStop(view.stopId)!.trip}
          pack={pack}
          online={d.online}
          record={d.record}
          onDone={() => {
            const next = nextStop(pack);
            go(next ? { name: "stop", stopId: next.stopId } : { name: "run" });
          }}
          onProblem={() => go({ name: "exception", stopId: view.stopId })}
          onBack={() => go({ name: "stop", stopId: view.stopId })}
        />
      )}
      {view.name === "exception" && findStop(view.stopId) && (
        <ExceptionView
          stop={findStop(view.stopId)!}
          trip={findStop(view.stopId)!.trip}
          now={now!.minute}
          record={d.record}
          onBack={() => go({ name: "stop", stopId: view.stopId })}
          onLateAccepted={() => go({ name: "deliver", stopId: view.stopId })}
          onDone={() => {
            const next = nextStop(pack);
            go(next ? { name: "stop", stopId: next.stopId } : { name: "run" });
          }}
        />
      )}
      {view.name === "outbox" && <OutboxView outbox={d.outbox} online={d.online} lastSync={d.lastSync} pack={pack} onBack={() => go({ name: "run" })} onSync={() => d.flush()} />}
    </div>
  );
}

function nextStop(pack: RunPack): PackStop | undefined {
  for (const t of pack.trips) for (const s of t.stops) if (s.status === "planned" || s.status === "arrived") return s;
  return undefined;
}

function EmptyState({ text, onRefresh }: { text: string; onRefresh?: () => Promise<boolean> }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center text-lg">
      <p>{text}</p>
      {onRefresh && (
        <Button size="field" variant="outline" className="border-2 border-foreground" onClick={() => void onRefresh()}>
          <RefreshCw /> Check again
        </Button>
      )}
    </div>
  );
}

function TopBar({ pack, online, queued, onOutbox }: { pack: RunPack; online: boolean; queued: number; onOutbox: () => void }) {
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b-2 border-foreground bg-background px-4 py-3">
      <div className="min-w-0">
        <p className="text-xl leading-tight font-bold">Today&apos;s run</p>
        <p className="text-sm text-muted-foreground">
          {dayLabel(pack.runDate)} · {pack.vehicle?.depot} depot
        </p>
      </div>
      <button
        onClick={onOutbox}
        className={cn(
          "inline-flex h-11 items-center gap-2 rounded-full border-2 px-3 text-base font-semibold",
          online ? "border-foreground" : "border-dashed border-foreground",
        )}
        aria-label={online ? `Online, ${queued} waiting` : `Offline, ${queued} saved on this phone`}
      >
        {online ? <Wifi className="size-5" /> : <WifiOff className="size-5" />}
        {online ? (queued ? `Syncing ${queued}` : "Online") : `Offline${queued ? ` · ${queued} waiting` : ""}`}
      </button>
    </header>
  );
}

/** Dispatcher messages and decisions (DG-02 answers) - big, plain, one tap to clear. */
function Notices({ notices, online }: { notices: NonNullable<RunPack["notices"]>; online: boolean }) {
  const [hidden, setHidden] = useState<string[]>([]);
  const shown = notices.filter((n) => !hidden.includes(n.id));
  if (!shown.length) return null;
  return (
    <section className="m-4 space-y-3" aria-label="From the dispatcher">
      {shown.map((n) => (
        <div
          key={n.id}
          className={cn(
            "space-y-2 rounded-lg border-2 p-4",
            n.severity === "conflict" ? "border-conflict-border bg-conflict-bg text-conflict" : "border-foreground bg-background text-foreground",
          )}
        >
          <p className="text-lg font-bold">{n.title}</p>
          <p className="text-base">{n.body}</p>
          <Button
            size="field"
            variant="outline"
            className="border-2 border-foreground bg-background text-foreground"
            onClick={() => {
              setHidden((h) => [...h, n.id]);
              if (online) {
                const f = new FormData();
                f.set("id", n.id);
                void ackDriverNoticeAction(f).catch(() => undefined);
              }
            }}
          >
            <Check /> OK
          </Button>
        </div>
      ))}
    </section>
  );
}

function PlanChanged({ stops, online, waiting }: { stops: PackStop[]; online: boolean; waiting: string[] }) {
  const [sentNow, setSent] = useState<string | null>(null);
  return (
    <section className="m-4 space-y-3 rounded-lg border-2 border-conflict-border bg-conflict-bg p-4 text-conflict">
      <p className="flex items-center gap-2 text-lg font-bold">
        <GitMerge className="size-5" /> Plan changed while you had no signal
      </p>
      {stops.map((s) => (
        <div key={s.stopId} className="space-y-2">
          <p className="text-base">
            <strong className="num">{s.outletId}</strong>{" "}
            {s.status === "skipped" ? "was moved to the next run by the dispatcher." : "was changed by the dispatcher (order or time)."} The dispatcher decides; stay
            parked and the answer comes here.
          </p>
          {s.status === "skipped" && (
            <div className="grid gap-2">
              <Button
                size="field"
                variant="outline"
                className="border-2 border-foreground bg-background text-foreground"
                disabled={!online || (sentNow === s.stopId || waiting.includes(s.stopId))}
                onClick={async () => {
                  const f = new FormData();
                  f.set("stopId", s.stopId);
                  const r = await canDeliverAction(f);
                  if (r.ok) {
                    setSent(s.stopId);
                    toast.success(r.message);
                  } else toast.error(r.error);
                }}
              >
                {(sentNow === s.stopId || waiting.includes(s.stopId)) ? "Sent - waiting for the dispatcher" : "Tell dispatcher: I can deliver now"}
              </Button>
              <p className="text-sm">Follow the change: keep the goods on board{s.temp === "chilled" ? " with the reefer running" : ""}.</p>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

function RunView({ pack, now, online, onOpen, record }: { pack: RunPack; now: number; online: boolean; onOpen: (stopId: string) => void; record: ReturnType<typeof useDriver>["record"] }) {
  const [pending, setPending] = useState(false);
  const active = pack.trips.find((t) => t.status !== "completed" && t.stops.some((s) => s.status === "planned" || s.status === "arrived")) ?? pack.trips[pack.trips.length - 1]!;
  const departed = active.status === "en_route" || active.departedMin !== null;
  const next = active.stops.find((s) => s.status === "planned" || s.status === "arrived");
  const units = active.stops.reduce((n, s) => n + s.units, 0);
  const kg = active.stops.reduce((n, s) => n + s.kg, 0);
  const chilled = active.stops.some((s) => s.temp === "chilled");

  return (
    <main className="space-y-4 p-4">
      <section className="flex gap-3 rounded-lg bg-delivered-bg p-4 text-delivered">
        <CircleCheck className="mt-0.5 size-7 shrink-0" />
        <div>
          <p className="text-xl font-bold">Offline ready</p>
          <p className="text-base">
            All {pack.trips.reduce((n, t) => n + t.stops.length, 0)} stops, windows, docks and the load list are saved on this phone.
            {online ? " Signal can drop on the road; the app keeps working." : " You have no signal - everything still works and is saved."}
          </p>
        </div>
      </section>

      <section className="space-y-2 rounded-lg border-2 border-foreground p-4">
        <div className="flex items-center gap-2">
          <BrandMark brand={active.brand} size={24} />
          <p className="num text-xl font-bold">
            {pack.vehicle!.id} · {active.code}
          </p>
        </div>
        <p className="text-base capitalize">
          {pack.vehicle!.temp} {pack.vehicle!.type} · {pack.vehicle!.depot} → {active.district}
          {pack.trips.length > 1 && ` · trip ${active.tripNo} of ${pack.trips.length}`}
        </p>
        <div className="flex flex-wrap gap-2">
          {chilled && (
            <span className="inline-flex h-9 items-center gap-1.5 rounded-md bg-chilled-bg px-3 font-semibold text-chilled">
              <Snowflake className="size-4" /> Chilled
            </span>
          )}
          <span className="num inline-flex h-9 items-center rounded-md border-2 border-foreground px-3 font-semibold">
            {units} units · {kg.toLocaleString("en-US", { maximumFractionDigits: 1 })} kg
          </span>
        </div>
        <p className="text-base">{active.signedOff ? "Loaded and signed off at the dock" : "Waiting for dock sign-off"}</p>
      </section>

      <ol className="overflow-hidden rounded-lg border-2 border-foreground">
        {active.stops.map((s, i) => (
          <li key={s.stopId} className={cn("border-b-2 last:border-0", s.status === "skipped" && "opacity-60")}>
            <button onClick={() => onOpen(s.stopId)} className="flex w-full items-center gap-3 px-3 py-3 text-left active:bg-muted">
              <span className={cn("num grid size-9 shrink-0 place-items-center rounded-full border-2 border-foreground text-lg font-bold", s.status === "delivered" && "bg-foreground text-background")}>
                {s.status === "delivered" ? <Check className="size-5" /> : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="num block text-xl font-bold">{s.outletId}</span>
                <span className="num block text-sm text-muted-foreground">
                  window {hhmm(s.open)}–{hhmm(s.close)} · {s.units} units
                </span>
              </span>
              <span className="text-right">
                {s.status === "delivered" ? (
                  <span className="num text-base font-semibold">done {hhmm(s.leftMin)}</span>
                ) : s.status === "exception" ? (
                  <StatusPill status="exception" />
                ) : s.status === "skipped" ? (
                  <StatusPill status="deferred">Moved</StatusPill>
                ) : (
                  <span className={cn("num text-xl font-bold", s.lateRisk && "text-late-risk")}>{hhmm(s.etaMin ?? s.plannedArrive)}</span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ol>

      {!departed ? (
        <div className="space-y-2">
          <p className="text-center text-base">
            Planned departure <span className="num font-bold">{hhmm(active.departureMin)}</span>
          </p>
          <Button
            size="hero"
            disabled={pending || !active.signedOff}
            onClick={async () => {
              setPending(true);
              try {
                await record({ type: "trip.depart", tripId: active.tripId, payload: { plannedDeparture: active.departureMin } });
                toast.success(online ? "Trip started" : "Trip started - saved on this phone");
                if (next) onOpen(next.stopId);
              } finally {
                setPending(false);
              }
            }}
          >
            {pending && <Loader2 className="animate-spin" />}
            {active.signedOff ? "Start trip" : "Waiting for dock sign-off"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">It is {hhmm(now)} on the business clock.</p>
        </div>
      ) : next ? (
        <Button size="hero" onClick={() => onOpen(next.stopId)}>
          <Navigation /> Next stop · {next.outletId}
        </Button>
      ) : (
        <div className="rounded-lg bg-delivered-bg p-4 text-center text-lg font-semibold text-delivered">All stops done. Drive back to the depot.</div>
      )}
    </main>
  );
}

function NextStopView({
  stop,
  trip,
  now,
  onBack,
  onArrive,
  onProblem,
  record,
}: {
  stop: PackStop;
  trip: PackTrip;
  now: number;
  onBack: () => void;
  onArrive: () => void;
  onProblem: () => void;
  record: ReturnType<typeof useDriver>["record"];
}) {
  const [driving, setDriving] = useState(false);
  // DR-02: when the phone reports speed, hide controls (use only when safely stopped)
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (p) => setDriving((p.coords.speed ?? 0) > 3),
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 5000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);
  const idx = trip.stops.findIndex((s) => s.stopId === stop.stopId);
  const eta = stop.etaMin ?? stop.plannedArrive;
  const late = eta !== null && eta > stop.close;
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${stop.outletName} ${stop.district} Sri Lanka`)}`;

  if (driving) {
    return (
      <main className="flex min-h-[80dvh] flex-col justify-center gap-6 bg-foreground p-6 text-background">
        <p className="text-lg font-semibold">Driving</p>
        <p className="text-sm tracking-widest uppercase">Next stop</p>
        <p className="num text-6xl font-bold">{stop.outletId}</p>
        <p className="text-2xl">
          Arrive about <span className="num font-bold">{hhmm(eta)}</span>
        </p>
        <p className="text-xl">Window closes {hhmm(stop.close)}</p>
        <p className="text-lg">Controls are hidden while the truck is moving. Pull over to use the app.</p>
        <Button variant="outline" size="field" className="border-background bg-transparent text-background" onClick={() => setDriving(false)}>
          I&apos;m parked
        </Button>
      </main>
    );
  }
  return (
    <main className="space-y-4 p-4">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-base font-semibold">
        <ArrowLeft className="size-5" /> Run
      </button>
      <p className="text-base text-muted-foreground">
        Stop {idx + 1} of {trip.stops.length} · {trip.code}
      </p>
      <section className="space-y-3 rounded-lg border-2 border-foreground p-4">
        <p className="text-sm font-semibold tracking-widest uppercase">Next stop</p>
        <p className="num text-[44px] leading-none font-bold">{stop.outletId}</p>
        <p className="text-base">
          {stop.outletName} · {stop.district}
        </p>
        <div className="grid grid-cols-2 gap-3 border-t-2 pt-3">
          <div>
            <p className="text-sm">Arrive about</p>
            <p className={cn("num text-3xl font-bold", late && "text-exception")}>{hhmm(eta)}</p>
            <p className="num text-sm text-muted-foreground">planned {hhmm(stop.plannedArrive)}</p>
          </div>
          <div>
            <p className="text-sm">Window closes</p>
            <p className="num text-3xl font-bold">{hhmm(stop.close)}</p>
            <p className="num text-sm text-muted-foreground">opens {hhmm(stop.open)}</p>
          </div>
        </div>
        <dl className="grid grid-cols-[6rem_1fr] gap-y-2 border-t-2 pt-3 text-base">
          <dt className="font-semibold">Dock</dt>
          <dd className="capitalize">{DOCK_LABEL[stop.dock]}</dd>
          <dt className="font-semibold">Access</dt>
          <dd>{stop.parking === "van_only" ? "Van only - trucks can't reach" : stop.parking === "mall_dock" ? `Mall bay, window ${stop.mallWindow}` : "Normal parking"}</dd>
          <dt className="font-semibold">Unload</dt>
          <dd className="flex items-center gap-2">
            {stop.temp === "chilled" && (
              <span className="inline-flex items-center gap-1 rounded-md bg-chilled-bg px-2 font-semibold text-chilled">
                <Snowflake className="size-4" /> Chilled
              </span>
            )}
            <span className="num font-semibold">{stop.units} units</span>
          </dd>
        </dl>
        {late && (
          <p className="flex items-center gap-2 rounded-md bg-late-risk-bg p-2 text-base font-semibold text-late-risk">
            <TriangleAlert className="size-5" /> Expected after the window closes
          </p>
        )}
      </section>
      <button onClick={onProblem} className="text-base font-semibold underline underline-offset-4">
        Problem at this stop?
      </button>
      <div className="grid gap-2">
        <Button asChild size="hero" variant="outline" className="border-2 border-foreground">
          <a href={maps} target="_blank" rel="noreferrer">
            <MapPin /> Navigate in Google Maps
          </a>
        </Button>
        <Button
          size="hero"
          disabled={stop.status === "delivered" || stop.status === "skipped"}
          onClick={async () => {
            if (stop.status === "planned") await record({ type: "stop.arrive", tripId: trip.tripId, stopId: stop.stopId, baseVersion: stop.version });
            onArrive();
          }}
        >
          {stop.status === "delivered" ? "Delivered" : stop.status === "skipped" ? "Moved by the dispatcher" : "I've arrived"}
        </Button>
        <p className="text-center text-sm text-muted-foreground">Business time {hhmm(now)}</p>
      </div>
    </main>
  );
}

function DeliverView({
  stop,
  trip,
  pack,
  online,
  record,
  onDone,
  onProblem,
  onBack,
}: {
  stop: PackStop;
  trip: PackTrip;
  pack: RunPack;
  online: boolean;
  record: ReturnType<typeof useDriver>["record"];
  onDone: () => void;
  onProblem: () => void;
  onBack: () => void;
}) {
  const [units, setUnits] = useState(stop.units);
  const [cold, setCold] = useState(stop.temp !== "chilled");
  const [name, setName] = useState("");
  const [signed, setSigned] = useState(false);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [usePhoto, setUsePhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ at: number } | null>(null);
  const sig = useRef<SignatureHandle>(null);
  const file = useRef<HTMLInputElement>(null);
  const next = pack.trips.flatMap((t) => t.stops).find((s) => s.stopId !== stop.stopId && (s.status === "planned" || s.status === "arrived"));
  const proofOk = usePhoto ? !!photo : signed;
  const arrived = stop.arrivedMin ?? clockNow(pack.clock).minute;

  if (done) {
    return (
      <main className="space-y-4 p-4">
        <section className="flex gap-3 rounded-lg bg-delivered-bg p-4 text-delivered">
          <CircleCheck className="size-8 shrink-0" />
          <div>
            <p className="text-2xl font-bold">Delivered</p>
            <p className="text-base">{online ? "Saved and sending now." : "Saved on this phone."}</p>
          </div>
        </section>
        <dl className="grid grid-cols-2 gap-y-2 rounded-lg border-2 border-foreground p-4 text-lg">
          <dt>Arrived</dt>
          <dd className="num text-right font-bold">{hhmm(arrived)}</dd>
          <dt>Handed over</dt>
          <dd className="num text-right font-bold">{hhmm(done.at)}</dd>
          <dt>Units</dt>
          <dd className="num text-right font-bold">
            {units} of {stop.units}
            {stop.temp === "chilled" && " · cold"}
          </dd>
          <dt>Proof</dt>
          <dd className="text-right font-bold">{usePhoto ? "Photo" : "Signature"} + name</dd>
        </dl>
        <p className="text-base">{online ? "The store sees it now." : "It will send by itself when the phone finds signal. You don't need to do anything."}</p>
        {next ? (
          <section className="space-y-2 rounded-lg border-2 border-foreground p-4">
            <p className="text-sm font-semibold tracking-widest uppercase">Next · stop</p>
            <p className="flex items-baseline justify-between">
              <span className="num text-3xl font-bold">{next.outletId}</span>
              <span className="num text-2xl font-bold">~{hhmm(next.etaMin ?? next.plannedArrive)}</span>
            </p>
            <p className="num text-base">
              Window {hhmm(next.open)}–{hhmm(next.close)} · {next.units} units
            </p>
          </section>
        ) : null}
        <Button size="hero" onClick={onDone}>
          {next ? "Go to next stop" : "Back to run"}
        </Button>
      </main>
    );
  }

  return (
    <main className="space-y-4 p-4">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-base font-semibold">
        <ArrowLeft className="size-5" /> {stop.outletId}
      </button>
      <div className="flex items-baseline justify-between">
        <p className="num text-3xl font-bold">{stop.outletId}</p>
        <p className="text-base">
          Stop {trip.stops.findIndex((s) => s.stopId === stop.stopId) + 1} of {trip.stops.length} · {DOCK_LABEL[stop.dock]}
        </p>
      </div>
      <div className="grid grid-cols-3 overflow-hidden rounded-lg border-2 border-foreground text-center text-base font-semibold">
        <span className="bg-foreground py-2 text-background">Arrived {hhmm(arrived)}</span>
        <span className="border-x-2 border-foreground py-2">Unloaded</span>
        <span className={cn("py-2", proofOk && "bg-foreground text-background")}>Proof</span>
      </div>

      <section className="space-y-2">
        <p className="text-lg font-semibold">Units handed over</p>
        <div className="flex items-center gap-3">
          <Button size="icon-lg" variant="outline" className="size-16 border-2 border-foreground" onClick={() => setUnits((u) => Math.max(0, u - 1))} aria-label="One less">
            <Minus className="size-7" />
          </Button>
          <input
            value={units}
            onChange={(e) => setUnits(Math.max(0, Math.min(stop.units, Number(e.target.value) || 0)))}
            inputMode="numeric"
            className="num h-16 flex-1 rounded-lg border-2 border-foreground bg-card text-center text-4xl font-bold"
            aria-label="Units handed over"
          />
          <Button size="icon-lg" variant="outline" className="size-16 border-2 border-foreground" onClick={() => setUnits((u) => Math.min(stop.units, u + 1))} aria-label="One more">
            <Plus className="size-7" />
          </Button>
        </div>
        <p className="text-center text-base">of {stop.units} on the load list</p>
      </section>

      {stop.temp === "chilled" && (
        <label className="flex min-h-14 items-center gap-3 rounded-lg border-2 border-foreground p-3 text-lg font-semibold">
          <input type="checkbox" checked={cold} onChange={(e) => setCold(e.target.checked)} className="size-7" />
          Chilled goods handed over cold
        </label>
      )}

      <section className="space-y-2">
        <label htmlFor="recv" className="text-lg font-semibold">
          Received by
        </label>
        <input id="recv" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name of the person receiving" className="h-14 w-full rounded-lg border-2 border-foreground bg-card px-3 text-lg" />
        {usePhoto ? (
          <div className="space-y-2">
            <input ref={file} type="file" accept="image/*" capture="environment" className="hidden" onChange={async (e) => e.target.files?.[0] && setPhoto(await downscale(e.target.files[0]))} />
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={URL.createObjectURL(photo)} alt="Proof of delivery" className="h-40 w-full rounded-lg border-2 border-foreground object-cover" />
            ) : (
              <Button size="field" variant="outline" className="border-2 border-foreground" onClick={() => file.current?.click()}>
                <Camera /> Take a photo of the delivered goods
              </Button>
            )}
            <button className="text-base underline" onClick={() => setUsePhoto(false)}>
              Signature instead
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <SignaturePad ref={sig} onChange={(empty) => setSigned(!empty)} />
            <button className="text-base underline" onClick={() => setUsePhoto(true)}>
              Photo instead
            </button>
          </div>
        )}
      </section>
      <p className="text-base">The time is added automatically when you tap Complete.</p>
      <button onClick={onProblem} className="text-base font-semibold underline underline-offset-4">
        Something is wrong at this stop
      </button>
      <Button
        size="hero"
        disabled={saving || !proofOk || !name.trim() || (stop.temp === "chilled" && !cold)}
        onClick={async () => {
          setSaving(true);
          try {
            const blobs: NonNullable<OutboxRow["blobs"]> = [];
            if (usePhoto && photo) blobs.push({ field: "photoKey", kind: "pod", blob: photo });
            if (!usePhoto) {
              const b = await sig.current?.toBlob();
              if (b) blobs.push({ field: "signatureKey", kind: "signature", blob: b });
            }
            const row = await record({
              type: "stop.deliver",
              tripId: trip.tripId,
              stopId: stop.stopId,
              baseVersion: stop.version,
              payload: { arrivedMin: arrived, unitsHanded: units, chilledOk: stop.temp === "chilled" ? cold : null, recipientName: name.trim() },
              blobs,
            });
            setDone({ at: row.atMin });
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not save");
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving && <Loader2 className="animate-spin" />}
        {!name.trim() ? "Add the receiver's name" : !proofOk ? (usePhoto ? "Add a photo" : "Ask them to sign") : "Complete delivery"}
      </Button>
    </main>
  );
}

const EXCEPTIONS = [
  { id: "late_accepted", title: "Delivered late, store accepted", sub: "Continue to proof of delivery" },
  { id: "outlet_closed", title: "Outlet closed", sub: "Nobody there to receive" },
  { id: "goods_refused", title: "Goods refused", sub: "All or part of the order" },
  { id: "mall_gate_refused", title: "Gate or bay refused", sub: "Could not reach the dock" },
  { id: "other", title: "Something else", sub: "Add a note and a photo" },
] as const;

function ExceptionView({
  stop,
  trip,
  now,
  record,
  onBack,
  onLateAccepted,
  onDone,
}: {
  stop: PackStop;
  trip: PackTrip;
  now: number;
  record: ReturnType<typeof useDriver>["record"];
  onBack: () => void;
  onLateAccepted: () => void;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<(typeof EXCEPTIONS)[number]["id"] | null>(null);
  const [refused, setRefused] = useState(stop.units);
  const [reason, setReason] = useState("Too late");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [saving, setSaving] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const lateNow = now > stop.close;
  const needsPhoto = kind === "goods_refused" || kind === "other";

  return (
    <main className="space-y-4 p-4">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-base font-semibold">
        <ArrowLeft className="size-5" /> {stop.outletId}
      </button>
      <p className="num text-3xl font-bold">{stop.outletId}</p>
      {lateNow && (
        <p className="rounded-md bg-late-risk-bg p-3 text-base font-semibold text-late-risk">
          It is {hhmm(now)}. The window closed at {hhmm(stop.close)}.
        </p>
      )}
      <p className="text-lg font-semibold">What happened at this stop?</p>
      <div className="space-y-2" role="radiogroup">
        {EXCEPTIONS.map((e) => (
          <button
            key={e.id}
            role="radio"
            aria-checked={kind === e.id}
            onClick={() => setKind(e.id)}
            className={cn("w-full rounded-lg border-2 border-foreground p-3 text-left", kind === e.id && "bg-foreground text-background")}
          >
            <span className="block text-lg font-bold">{e.title}</span>
            <span className="block text-base opacity-80">{e.sub}</span>
          </button>
        ))}
      </div>

      {kind === "goods_refused" && (
        <section className="space-y-3 rounded-lg border-2 border-foreground p-3">
          <p className="text-lg font-semibold">Units refused</p>
          <div className="flex items-center gap-3">
            <Button size="icon-lg" variant="outline" className="size-14 border-2 border-foreground" onClick={() => setRefused((u) => Math.max(1, u - 1))} aria-label="One less">
              <Minus className="size-6" />
            </Button>
            <span className="num w-20 text-center text-4xl font-bold">{refused}</span>
            <Button size="icon-lg" variant="outline" className="size-14 border-2 border-foreground" onClick={() => setRefused((u) => Math.min(stop.units, u + 1))} aria-label="One more">
              <Plus className="size-6" />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {["Too late", "Damaged", "Not cold", "Not ordered"].map((r) => (
              <button key={r} onClick={() => setReason(r)} className={cn("h-12 rounded-lg border-2 border-foreground font-semibold", reason === r && "bg-foreground text-background")}>
                {r}
              </button>
            ))}
          </div>
          {stop.temp === "chilled" && <p className="text-base font-semibold">Keep refused goods on the truck with the reefer running. The dispatcher decides where they go.</p>}
        </section>
      )}

      {kind && kind !== "late_accepted" && (
        <section className="space-y-2">
          <input ref={file} type="file" accept="image/*" capture="environment" className="hidden" onChange={async (e) => e.target.files?.[0] && setPhoto(await downscale(e.target.files[0]))} />
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={URL.createObjectURL(photo)} alt="Exception evidence" className="h-32 w-full rounded-lg border-2 border-foreground object-cover" />
          ) : (
            <Button size="field" variant="outline" className="border-2 border-foreground" onClick={() => file.current?.click()}>
              <Camera /> Photo{needsPhoto ? " (required)" : ""}
            </Button>
          )}
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" rows={2} className="text-base" />
        </section>
      )}
      <p className="text-base">Recorded with the time and saved on the phone.</p>
      <Button
        size="hero"
        disabled={!kind || saving || (needsPhoto && !photo)}
        onClick={async () => {
          if (kind === "late_accepted") return onLateAccepted();
          setSaving(true);
          try {
            await record({
              type: "stop.exception",
              tripId: trip.tripId,
              stopId: stop.stopId,
              baseVersion: stop.version,
              payload: {
                exceptionType: kind,
                note: [kind === "goods_refused" ? `${refused} units refused: ${reason}` : null, note].filter(Boolean).join(" · ") || null,
                unitsReturned: kind === "goods_refused" ? refused : null,
              },
              blobs: photo ? [{ field: "photoKey", kind: "exception", blob: photo }] : [],
            });
            toast.success("Recorded. The dispatcher and the store are told.");
            onDone();
          } finally {
            setSaving(false);
          }
        }}
      >
        {kind === "late_accepted" ? "Continue to proof" : "Report and leave stop"}
      </Button>
    </main>
  );
}

const TYPE_LABEL: Record<string, string> = { "trip.depart": "Departed", "stop.arrive": "Arrived", "stop.deliver": "Proof", "stop.exception": "Exception" };

function OutboxView({ outbox, online, lastSync, pack, onBack, onSync }: { outbox: OutboxRow[]; online: boolean; lastSync: string | null; pack: RunPack; onBack: () => void; onSync: () => Promise<void> }) {
  const stops = new Map(pack.trips.flatMap((t) => t.stops.map((s) => [s.stopId, s])));
  const waiting = outbox.filter((o) => o.status === "queued");
  const rows = [...outbox].sort((a, b) => b.seq - a.seq).slice(0, 40);
  return (
    <main className="space-y-4 p-4">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-base font-semibold">
        <ArrowLeft className="size-5" /> Run
      </button>
      <h1 className="text-2xl font-bold">Outbox</h1>
      <section className={cn("rounded-lg border-2 p-4 text-base", online ? "border-foreground" : "border-dashed border-foreground")}>
        <p className="flex items-center gap-2 text-lg font-bold">
          {online ? <Wifi className="size-5" /> : <CloudOff className="size-5" />}
          {online ? (waiting.length ? `Sending ${waiting.length}` : "Everything is sent") : "No signal"}
        </p>
        <p>
          {waiting.length} record{waiting.length === 1 ? "" : "s"} saved on this phone.{lastSync ? ` Last synced ${new Date(lastSync).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.` : ""}
        </p>
      </section>
      <ol className="divide-y-2 overflow-hidden rounded-lg border-2 border-foreground">
        {rows.map((o) => {
          const s = o.stopId ? stops.get(o.stopId) : null;
          return (
            <li key={o.eventId} className="flex items-center gap-3 p-3">
              <span className="num w-14 text-lg font-bold">{hhmm(o.atMin)}</span>
              <span className="min-w-0 flex-1">
                <span className="num block text-lg font-bold">
                  {s?.outletId ?? "Trip"} · {TYPE_LABEL[o.type]}
                </span>
                {o.type === "stop.deliver" && (
                  <span className="block text-sm">
                    {String(o.payload.unitsHanded ?? "")} units · {o.payload.photoKey || o.blobs?.some((b) => b.field === "photoKey") ? "photo" : "signature"}
                  </span>
                )}
                {o.lastError && o.status !== "sent" && <span className="block text-sm text-muted-foreground">{o.lastError}</span>}
              </span>
              <span
                className={cn(
                  "rounded-full border-2 px-3 py-1 text-sm font-semibold",
                  o.status === "queued" && "border-dashed border-foreground",
                  o.status === "sent" && "border-delivered-border bg-delivered-bg text-delivered",
                  o.status === "conflict" && "border-conflict-border bg-conflict-bg text-conflict",
                  o.status === "rejected" && "border-exception-border bg-exception-bg text-exception",
                )}
              >
                {o.status === "queued" ? "Waiting" : o.status === "sent" ? "Sent" : o.status === "conflict" ? "Conflict" : "Rejected"}
              </span>
            </li>
          );
        })}
        {rows.length === 0 && <li className="p-4 text-base text-muted-foreground">Nothing recorded yet.</li>}
      </ol>
      <p className="text-base">
        Records send by themselves, oldest first, when there&apos;s signal - with the times they happened, not the time they were sent. If the dispatcher
        changed a stop in the meantime, you&apos;ll be asked. Nothing is overwritten silently.
      </p>
      <Button size="field" variant="outline" className="border-2 border-foreground" disabled={!online || !waiting.length} onClick={() => void onSync()}>
        <RefreshCw /> Send now
      </Button>
    </main>
  );
}
