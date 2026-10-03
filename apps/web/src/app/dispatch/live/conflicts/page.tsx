import { ArrowLeft, Check, GitMerge, Truck, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/wp/action-button";
import { StatusPill } from "@/components/wp/chips";
import { RealtimeRefresh } from "@/components/wp/realtime";
import { Panel, PanelHeader } from "@/components/wp/panel";
import { colombo, dayLabel, hhmm } from "@/lib/format";
import { reconciliation, type ConflictCard } from "@/lib/server/live";
import { cn } from "@/lib/utils";
import { DispatchHeader } from "../../_components/header";
import { currentDepot } from "../../depot";
import { askStoreAction, resolveConflictAction } from "../actions";

export const metadata: Metadata = { title: "DG-02 Reconciliation" };

const KIND: Record<string, string> = {
  DRIVER_CAN_DELIVER: "The driver can still deliver",
  STOP_CHANGED: "Recorded offline on a stop you changed",
  STORE_ALREADY_REPORTED: "Delivered offline after the store reported a problem",
};

/** DG-02: after a dead zone, the truth of what happened (times as recorded) next to decisions that truth makes wrong. */
export default async function ReconciliationPage() {
  const depot = await currentDepot();
  const { cards, trips } = await reconciliation(depot);
  const open = cards.filter((c) => c.status === "open");
  const done = cards.filter((c) => c.status !== "open");

  return (
    <>
      <RealtimeRefresh channels={["ops"]} fallbackSeconds={20} />
      <DispatchHeader
        title="Reconciliation"
        context={`${depot} · ${open.length} open conflict${open.length === 1 ? "" : "s"}`}
        depot={depot}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/dispatch/live">
              <ArrowLeft /> Live operations
            </Link>
          </Button>
        }
      />
      <main className="space-y-6 p-6">
        {cards.length === 0 && (
          <Panel className="p-6 text-sm text-muted-foreground">
            No conflicts. They appear here when a truck comes back online with records that clash with a change made while it had no signal, or
            when a driver asks to deliver a stop you moved.
          </Panel>
        )}

        {trips.map((tr) => {
          const tripOpen = open.filter((c) => c.stop.tripId === tr.id);
          const tripDone = done.filter((c) => c.stop.tripId === tr.id);
          if (!tripOpen.length && !tripDone.length) return null;
          const changes = [...tripOpen, ...tripDone].filter((c) => c.deferral);
          return (
            <section key={tr.id} className="space-y-4">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <h2 className="num text-lg font-semibold">
                  {tr.vehicleId} · {tr.code}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {tr.district} · last heard from {hhmm(tr.lastSeenMin)}
                </p>
              </div>
              <p className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg border bg-card px-4 py-3 text-sm">
                <span>
                  <strong className="num">{tr.received}</strong> records received
                </span>
                <span>
                  <strong className="num">0</strong> lost
                </span>
                <span>times as recorded</span>
                <span className={cn(tripOpen.length && "font-medium text-conflict")}>
                  {tripOpen.length} open conflict{tripOpen.length === 1 ? "" : "s"}
                </span>
              </p>
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                <Panel>
                  <PanelHeader title="What happened on the trip" aside="as the driver recorded it" />
                  <ol className="divide-y">
                    {tr.stops.map((s) => {
                      const change = changes.find((c) => c.stop.outletId === s.outletId);
                      return (
                        <li key={`${s.outletId}-${s.seq}`} className="grid grid-cols-[6.5rem_5rem_1fr] items-start gap-3 px-4 py-3 text-sm">
                          <span className="num text-muted-foreground">
                            {s.arrivedMin !== null ? `${hhmm(s.arrivedMin)}${s.leftMin !== null ? `–${hhmm(s.leftMin)}` : ""}` : change?.deferral?.decidedAt ? colombo(change.deferral.decidedAt) : "—"}
                          </span>
                          <span className="num font-medium">{s.outletId}</span>
                          <span>
                            {s.status === "delivered" ? (
                              <>
                                <span className={cn("font-medium", s.arrivedMin !== null && s.arrivedMin > s.close && "text-late-risk")}>
                                  {s.arrivedMin !== null && s.arrivedMin > s.close ? "Delivered late" : "Delivered"}
                                </span>
                                <span className="block text-[13px] text-muted-foreground">
                                  {s.units ?? "—"} units, signed ·{" "}
                                  {s.arrivedMin !== null && s.arrivedMin > s.close
                                    ? `${Math.round(s.arrivedMin - s.close)} min after the ${hhmm(s.close)} close`
                                    : `on time (closes ${hhmm(s.close)})`}
                                </span>
                              </>
                            ) : s.status === "skipped" ? (
                              <>
                                <span className="font-medium text-deferred">Your change: moved to {change?.deferral?.newRunDate ? dayLabel(change.deferral.newRunDate) : "the next run"}</span>
                                <span className="block text-[13px] text-muted-foreground">{change?.deferral?.explanation ?? "Made while the truck had no signal."}</span>
                              </>
                            ) : s.status === "exception" ? (
                              <span className="font-medium text-exception">Not delivered</span>
                            ) : s.status === "arrived" ? (
                              <span className="font-medium">At the stop</span>
                            ) : (
                              <span className="text-muted-foreground">Not reached yet</span>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                  <p className="border-t px-4 py-3 text-[13px] text-muted-foreground">
                    Live operations, store tracking and the lateness history show these times as recorded, not the time the phone reconnected, so
                    lateness is measured against when the truck really arrived.
                  </p>
                </Panel>
                <div className="space-y-4">
                  {tripOpen.map((c) => (
                    <Conflict key={c.id} c={c} />
                  ))}
                  {tripDone.map((c) => (
                    <Panel key={c.id} className="flex items-start gap-3 p-4 text-sm">
                      <Check className="mt-0.5 size-4 text-delivered" />
                      <div>
                        <p className="font-medium">
                          {c.stop.outletId}: {c.resolution}
                        </p>
                        <p className="text-[13px] text-muted-foreground">{KIND[c.kind] ?? c.kind} · decided</p>
                      </div>
                    </Panel>
                  ))}
                </div>
              </div>
            </section>
          );
        })}
      </main>
    </>
  );
}

function Conflict({ c }: { c: ConflictCard }) {
  const s = c.stop;
  const moved = s.status === "skipped";
  const ask = (c.detail as { storeAsk?: { askedMin: number; eta: number } }).storeAsk ?? null;
  const driver = typeof c.detail.driver === "string" ? c.detail.driver : "The driver";
  return (
    <Panel className="border-conflict-border">
      <div className="flex items-center justify-between gap-3 border-b border-conflict-border bg-conflict-bg px-4 py-3 text-conflict">
        <span className="flex items-center gap-2 font-semibold">
          <GitMerge className="size-4" />
          Conflict · <span className="num">{s.outletId}</span>
        </span>
        <span className="text-[13px]">{KIND[c.kind] ?? c.kind}</span>
      </div>
      <div className="grid gap-px bg-border sm:grid-cols-2">
        <div className="space-y-1 bg-card p-4">
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <UserRound className="size-4" /> Your change{c.deferral?.decidedAt ? ` · ${colombo(c.deferral.decidedAt)}` : ""}
          </p>
          {moved || c.deferral ? (
            <>
              <p className="font-medium">Moved to {c.deferral?.newRunDate ? dayLabel(c.deferral.newRunDate) : "the next run"}</p>
              <p className="text-[13px] text-muted-foreground">
                {c.deferral?.explanation ?? "Decided with no word from the truck."} The store was told; a slot is held on that run.
              </p>
            </>
          ) : (
            <>
              <p className="font-medium">Stop changed on the plan</p>
              <p className="text-[13px] text-muted-foreground">
                The phone saw version {String(c.detail.phoneVersion ?? "?")}, the plan is at version {String(c.detail.serverVersion ?? s.version)}.
              </p>
            </>
          )}
        </div>
        <div className="space-y-1 bg-card p-4">
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Truck className="size-4" /> The truck · {colombo(c.createdAt)}
          </p>
          {c.kind === "DRIVER_CAN_DELIVER" ? (
            <>
              <p className="font-medium">Close to {s.outletId} with the goods on board</p>
              <p className="text-[13px] text-muted-foreground">
                {s.units} units. {driver} is parked and says: &ldquo;I can deliver now.&rdquo;
              </p>
            </>
          ) : c.kind === "STORE_ALREADY_REPORTED" ? (
            <>
              <p className="font-medium">Delivered {hhmm(s.arrivedMin)} while offline</p>
              <p className="text-[13px] text-muted-foreground">The store had already reported a problem with this order. Both records are kept.</p>
            </>
          ) : (
            <>
              <p className="font-medium">
                Recorded {String(c.detail.type ?? "a stop event").replace("stop.", "")} {s.arrivedMin !== null ? `at ${hhmm(s.arrivedMin)}` : ""}
              </p>
              <p className="text-[13px] text-muted-foreground">Kept as recorded - a fact from the road is never dropped.</p>
            </>
          )}
        </div>
      </div>
      <div className="space-y-3 p-4">
        {moved ? (
          <>
            <p className="text-sm font-medium">Decide</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border p-3 text-[13px]">
                <p className="font-medium">Deliver today</p>
                <p className="text-muted-foreground">
                  Cancels the move and frees the slot on the next run. The window closes {hhmm(s.close)}, so the store is asked to accept a late delivery.
                </p>
              </div>
              <div className="rounded-lg border p-3 text-[13px]">
                <p className="font-medium">Keep the next run</p>
                <p className="text-muted-foreground">
                  The {s.units} units ride back to the depot and go first on the next run. The store keeps the notice it already has.
                </p>
              </div>
            </div>
            {ask ? (
              <p className="rounded-md border border-conflict-border bg-conflict-bg p-3 text-[13px] text-conflict">
                <strong>Waiting for {s.outletId}&apos;s answer</strong> · asked {hhmm(ask.askedMin)}, arrival about {hhmm(ask.eta)}. The store sees
                &ldquo;Accept today&rdquo; or &ldquo;Keep it for the next run&rdquo;; the driver waits parked and gets the answer.
              </p>
            ) : (
              <p className="text-[13px] text-muted-foreground">The driver waits parked. The answer goes to the driver and the store.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <ActionButton action={resolveConflictAction} fields={{ conflictId: c.id, resolution: "keep_next_run" }} variant="outline">
                Keep the next run
              </ActionButton>
              {ask ? (
                <ActionButton
                  action={resolveConflictAction}
                  fields={{ conflictId: c.id, resolution: "deliver_today" }}
                  variant="outline"
                  confirm={`Deliver today without ${s.outletId}'s answer? Use this only if the store agreed by phone.`}
                >
                  Deliver today without waiting
                </ActionButton>
              ) : (
                <ActionButton action={askStoreAction} fields={{ conflictId: c.id }}>
                  Deliver today · ask the store
                </ActionButton>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill status="conflict">Needs a look</StatusPill>
            <ActionButton action={resolveConflictAction} fields={{ conflictId: c.id, resolution: "accept_recorded" }}>
              Accept as recorded
            </ActionButton>
          </div>
        )}
      </div>
    </Panel>
  );
}
