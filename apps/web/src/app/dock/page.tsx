import { PageTour } from "@/components/wp/tour";
import { QUEUE_TOUR } from "@/lib/tours/loader";
import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { StatusPill, TempTag } from "@/components/wp/chips";
import { dayLabel, hhmm } from "@/lib/format";
import { dockQueue, type DockTrip } from "@/lib/server/dock";
import type { DepotId } from "@/lib/server/planning";
import { requireUser } from "@/lib/server/session";
import { cn } from "@/lib/utils";
import { dockRun } from "./run";

export const metadata: Metadata = { title: "L-01 Dock queue" };

const STATE: Record<DockTrip["state"], (t: DockTrip) => React.ReactNode> = {
  not_started: () => <span className="inline-flex h-10 items-center rounded-full border-2 border-dashed px-4 font-semibold">Not started</span>,
  loading: (t) => <StatusPill status="loading" size="lg">Loading {t.loaded} of {t.stops}</StatusPill>,
  ready: () => <span className="inline-flex h-10 items-center rounded-full bg-primary px-4 font-semibold text-primary-foreground">Ready to sign off</span>,
  blocked: (t) => <StatusPill status="exception" size="lg">{t.shortfalls} shortfall</StatusPill>,
  signed_off: () => <StatusPill status="delivered" size="lg">Signed off</StatusPill>,
  departed: () => <StatusPill status="en-route" size="lg">Departed</StatusPill>,
};

export default async function DockQueuePage({ searchParams }: PageProps<"/dock">) {
  const user = await requireUser(["loader"]);
  const depot = (user.depotId ?? "Peliyagoda") as DepotId;
  const { runDate, clock } = await dockRun(depot);
  const { plan, trips } = await dockQueue(depot, runDate);
  const sp = await searchParams;
  const tab = sp.tab === "later" ? "later" : sp.tab === "gone" ? "gone" : "next";
  // before the run day, everything counts as "next"; on the day, split by the business clock
  const nowMin = clock.date === runDate ? clock.minute : clock.date < runDate ? -Infinity : Infinity;
  const gone = trips.filter((t) => t.state === "departed");
  const pendingTrips = trips.filter((t) => t.state !== "departed");
  const next = pendingTrips.filter((t) => (t.departureMin ?? 0) <= nowMin + 90 || nowMin === -Infinity);
  const later = pendingTrips.filter((t) => !next.includes(t));
  const shown = tab === "gone" ? gone : tab === "later" ? later : next;

  return (
    <main className="space-y-3 p-4">
      <PageTour id="l01" steps={QUEUE_TOUR} large />
      <p className="text-sm text-muted-foreground">
        {plan ? `Plan v${plan.version} for ${dayLabel(runDate)} · ${trips.length} load lists, ordered by departure` : `No published plan for ${dayLabel(runDate)} yet.`}
      </p>
      <nav className="grid grid-cols-3 overflow-hidden rounded-lg border-2 border-foreground" aria-label="Queue" data-tour="queue-tabs">
        {(
          [
            ["next", `Next 90 min · ${next.length}`],
            ["later", `Later · ${later.length}`],
            ["gone", `Departed · ${gone.length}`],
          ] as const
        ).map(([k, label]) => (
          <Link
            key={k}
            href={`/dock?tab=${k}`}
            aria-current={tab === k ? "page" : undefined}
            className={cn("flex h-14 items-center justify-center px-2 text-center text-base leading-tight font-semibold", tab === k && "bg-foreground text-background")}
          >
            {label}
          </Link>
        ))}
      </nav>
      <ul className="space-y-2" data-tour="load-lists">
        {shown.map((t) => (
          <li key={t.id}>
            <Link
              href={`/dock/${t.id}`}
              className="flex min-h-22 items-center gap-4 rounded-lg border-2 border-foreground bg-card px-4 py-3 active:bg-muted"
            >
              <span className="num w-20 shrink-0 text-3xl font-bold">{hhmm(t.departureMin)}</span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="num text-xl font-bold">{t.vehicleId}</span>
                  {t.changed && <span className="rounded-md border-2 border-foreground px-2 text-sm font-semibold" title="Stops changed after the first draft">Changed at publish</span>}
                </span>
                <span className="num block text-base text-muted-foreground">
                  {t.code} · {t.district} · {t.stops} stop{t.stops === 1 ? "" : "s"} · {t.units} units
                </span>
                <span className="mt-1.5 block sm:hidden">{STATE[t.state](t)}</span>
              </span>
              <span className="hidden sm:block">
                <TempTag temp={t.chilled ? "chilled" : "ambient"} size="lg" />
              </span>
              <span className="hidden shrink-0 sm:block">{STATE[t.state](t)}</span>
              <ChevronRight className="size-7 shrink-0" aria-hidden />
            </Link>
          </li>
        ))}
        {shown.length === 0 && <li className="rounded-lg border-2 border-dashed p-8 text-center text-lg text-muted-foreground">Nothing here.</li>}
      </ul>
    </main>
  );
}
