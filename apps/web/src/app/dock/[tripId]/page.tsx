import { PageTour } from "@/components/wp/tour";
import { LOAD_LIST_TOUR } from "@/lib/tours/loader";
import { Check, ChevronLeft, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/wp/action-button";
import { TempTag } from "@/components/wp/chips";
import { DOCK_LABEL, hhmm, kg, m3 } from "@/lib/format";
import { loadList } from "@/lib/server/dock";
import { requireUser } from "@/lib/server/session";
import { cn } from "@/lib/utils";
import { markLoadedAction } from "../actions";

export const metadata: Metadata = { title: "L-02 Load list" };

/** L-02: load in reverse stop order - the last stop goes in first, stop 1 by the door. */
export default async function LoadListPage({ params }: PageProps<"/dock/[tripId]">) {
  const user = await requireUser(["loader"]);
  const { tripId } = await params;
  const list = await loadList(tripId);
  if (!list || (user.depotId && list.trip.depotId !== user.depotId)) notFound();
  const { trip, stops, checks, shortfalls, signed } = list;
  const loaded = new Map(checks.map((c) => [c.orderId, c]));
  const flagged = new Map(shortfalls.map((s) => [s.orderId, s]));
  const reversed = [...stops].reverse();
  const current = reversed.find((s) => !loaded.has(s.orderId) && !flagged.has(s.orderId));
  const doneUnits = stops.filter((s) => loaded.has(s.orderId)).reduce((n, s) => n + s.units, 0);
  const allUnits = stops.reduce((n, s) => n + s.units, 0);
  const handled = stops.filter((s) => loaded.has(s.orderId) || flagged.has(s.orderId)).length;
  const locked = !!signed || trip.status === "en_route" || trip.status === "completed";
  const chilled = stops.some((s) => s.temp === "chilled");

  return (
    <main className="space-y-3 p-4">
      <PageTour id="l02" steps={LOAD_LIST_TOUR} large />
      <div className="flex items-start gap-3" data-tour="trip-head">
        <Link href="/dock" className="mt-1 rounded-md border-2 border-foreground p-2" aria-label="Back to dock queue">
          <ChevronLeft className="size-6" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="num text-2xl font-bold">
            {trip.vehicleId} · {trip.code}
          </h1>
          <p className="text-base text-muted-foreground">
            {trip.vTemp} {trip.vType} · {trip.brand} · {trip.district} · {stops.length} stop{stops.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">Departs</p>
          <p className="num text-3xl font-bold">{hhmm(trip.departureMin)}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3" data-tour="progress">
        <TempTag temp={chilled ? "chilled" : "ambient"} size="lg" />
        <p className="num text-lg font-semibold">
          {handled} of {stops.length} stops · {doneUnits} of {allUnits} units
        </p>
      </div>
      <p className="text-base font-medium" data-tour="rule">Last stop goes in first. Stop 1 goes in last, by the door.</p>

      <ol className="space-y-2" data-tour="stops">
        {reversed.map((s, i) => {
          const isLoaded = loaded.has(s.orderId);
          const short = flagged.get(s.orderId);
          const isCurrent = !locked && current?.orderId === s.orderId;
          const status = short ? (
            <span className="inline-flex items-center gap-1 font-semibold text-exception sunlight:text-exception-bg">
              <TriangleAlert className="size-5" /> {short.units} {short.kind === "missing" ? "short" : "damaged"}
            </span>
          ) : isLoaded ? (
            <span className="inline-flex items-center gap-1 text-lg font-semibold">
              <Check className="size-6" /> Loaded
            </span>
          ) : isCurrent ? (
            <span className="text-base font-semibold">Checking</span>
          ) : (
            <span className="text-base text-muted-foreground">To load</span>
          );
          return (
            <li key={s.id} className={cn("rounded-lg border-2 bg-card", isCurrent ? "border-foreground" : "border-border", isLoaded && "opacity-80")}>
              <div className="flex items-center gap-3 p-3">
                <div className="w-16 shrink-0 text-center">
                  <p className="text-xs font-semibold tracking-wide uppercase">Load</p>
                  <p className="num text-3xl font-bold">{i + 1}</p>
                  <p className="text-xs text-muted-foreground">stop {s.seq}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="num text-2xl font-bold">{s.outletId}</p>
                  <p className="num text-sm text-muted-foreground">
                    {DOCK_LABEL[s.dock as keyof typeof DOCK_LABEL] ?? s.dock} · <span className="whitespace-nowrap">{hhmm(s.open)}–{hhmm(s.close)}</span>{" "}
                    {s.version > 1 && <strong className="text-foreground">· changed</strong>}
                  </p>
                  <div className="mt-1 sm:hidden">
                    {status}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="num text-3xl font-bold">{s.units}</p>
                  <p className="text-xs text-muted-foreground">units</p>
                </div>
                <div className="hidden w-28 text-right text-sm text-muted-foreground sm:block">
                  <p className="num">{kg(s.kg)}</p>
                  <p className="num">{m3(s.m3, 3)}</p>
                </div>
                <div className="hidden w-32 shrink-0 text-right sm:block">
                  {status}
                </div>
              </div>
              {isCurrent && (
                <div className="grid gap-2 border-t-2 p-3 sm:grid-cols-2" data-tour="check-stop">
                  <ActionButton action={markLoadedAction} fields={{ tripId, orderId: s.orderId, loaded: "1" }} size="hero">
                    <Check /> All {s.units} loaded
                  </ActionButton>
                  <Button asChild size="hero" variant="outline" className="border-2 border-foreground">
                    <Link href={`/dock/${tripId}/shortfall?order=${s.orderId}`}>Short or damaged</Link>
                  </Button>
                </div>
              )}
              {isLoaded && !locked && (
                <div className="border-t px-3 py-1.5 text-right">
                  <ActionButton action={markLoadedAction} fields={{ tripId, orderId: s.orderId, loaded: "0" }} variant="ghost" size="sm">
                    Undo
                  </ActionButton>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <p className="num text-sm text-muted-foreground">
        {kg(stops.reduce((n, s) => n + s.kg, 0))} · {m3(stops.reduce((n, s) => n + s.m3, 0))} on a {trip.capKg.toLocaleString("en-US")} kg / {trip.capM3} m³{" "}
        {trip.vType}
      </p>
      <Button asChild size="hero" variant={handled === stops.length ? "default" : "outline"} data-tour="to-signoff">
        <Link href={`/dock/${tripId}/sign-off`}>{signed ? "Signed off · view" : handled === stops.length ? "Sign off" : `Sign off · load all ${stops.length} stops first`}</Link>
      </Button>
    </main>
  );
}
