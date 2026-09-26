import { Ban, Check, ChevronLeft, Clock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/wp/action-button";
import { StatusPill } from "@/components/wp/chips";
import { colombo, hhmm } from "@/lib/format";
import { loadList } from "@/lib/server/dock";
import { requireUser } from "@/lib/server/session";
import { cn } from "@/lib/utils";
import { unitsFoundAction } from "../../actions";
import { SignOffButton } from "./sign-off-button";

export const metadata: Metadata = { title: "L-04 Dispatch sign-off" };

/** L-04: the last gate before a vehicle leaves. It only opens when the load is complete or the dispatcher has decided. */
export default async function SignOffPage({ params }: PageProps<"/dock/[tripId]/sign-off">) {
  const user = await requireUser(["loader"]);
  const { tripId } = await params;
  const list = await loadList(tripId);
  if (!list || (user.depotId && list.trip.depotId !== user.depotId)) notFound();
  const { trip, stops, checks, shortfalls, signed } = list;
  const loaded = new Set(checks.map((c) => c.orderId));
  const complete = stops.filter((s) => loaded.has(s.orderId));
  const openShorts = shortfalls.filter((s) => s.status === "open");
  const undecided = openShorts.filter((s) => !s.decision);
  const held = openShorts.filter((s) => s.decision === "HOLD");
  const sent = shortfalls.filter((s) => s.decision === "SEND_AND_WARN");
  const chilled = stops.some((s) => s.temp === "chilled") && trip.vTemp === "reefer";
  const changed = stops.filter((s) => s.version > 1);
  const notHandled = stops.filter((s) => !loaded.has(s.orderId) && !shortfalls.some((x) => x.orderId === s.orderId));
  const blockedReason = signed
    ? null
    : notHandled.length
      ? `Load ${notHandled.length} more stop${notHandled.length === 1 ? "" : "s"} first`
      : undecided.length
        ? `Sign-off blocked · ${undecided.length} shortfall unresolved`
        : held.length
          ? "Held by the dispatcher · mark the units found"
          : null;

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-4">
      <div className="flex items-start gap-3">
        <Link href={`/dock/${tripId}`} className="mt-1 rounded-md border-2 border-foreground p-2" aria-label="Back to load list">
          <ChevronLeft className="size-6" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Dispatch sign-off</h1>
          <p className="num text-lg">
            {trip.vehicleId} · {trip.code} · {trip.district}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">Planned departure</p>
          <p className="num text-3xl font-bold">{hhmm(trip.departureMin)}</p>
        </div>
      </div>

      <ul className="space-y-2">
        <Row ok={notHandled.length === 0 && openShorts.length === 0} title={`${complete.length} of ${stops.length} stops fully loaded, last stop first`}>
          {complete.map((s) => s.outletId).join(", ")} · {complete.reduce((n, s) => n + s.units, 0)} units
        </Row>
        {shortfalls.map((s) => {
          const stop = stops.find((x) => x.orderId === s.orderId);
          const resolved = s.status === "decided";
          return (
            <Row key={s.id} ok={resolved} hatched={!resolved} title={`${stop?.outletId} · ${s.units} unit${s.units === 1 ? "" : "s"} ${s.kind === "missing" ? "short" : "damaged"}${s.note ? ` (${s.note})` : ""}`}>
              Flagged {colombo(s.reportedAt)}{s.photoKey ? " with a photo" : ""} ·{" "}
              {s.decision === "SEND_AND_WARN"
                ? "dispatcher: send it and warn the store"
                : s.decision === "HOLD"
                  ? resolved
                    ? "held, units found"
                    : "dispatcher: hold until the units are found"
                  : "sent to the dispatcher"}
              {s.decision === "HOLD" && !resolved && (
                <div className="mt-2">
                  <ActionButton action={unitsFoundAction} fields={{ shortfallId: s.id }} size="field">
                    <Check /> {s.units} units found
                  </ActionButton>
                </div>
              )}
              {s.photoKey && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/files/${s.photoKey}`} alt="Shortfall evidence" className="mt-2 h-20 w-28 rounded border-2 border-foreground object-cover" />
              )}
            </Row>
          );
        })}
        {chilled && (
          <Row ok={!!signed} title="Reefer unit running, doors sealed">
            Confirmed by the loader at sign-off
          </Row>
        )}
        <Row ok title={`Load list matches plan v${trip.planVersion}`}>
          {changed.length ? `${changed.length} stop(s) changed after the first draft: ${changed.map((s) => s.outletId).join(", ")}` : "No changes since publish"}
        </Row>
      </ul>

      {undecided.length > 0 && (
        <div className="flex gap-3 rounded-lg border-2 border-dashed p-4 text-base">
          <Clock className="mt-0.5 size-6 shrink-0" />
          <p>
            <strong>Waiting for the dispatcher.</strong> They will either hold {trip.vehicleId} until the units are found, or send it now and warn the store.
            You&apos;ll see the decision here.
          </p>
        </div>
      )}
      {sent.length > 0 && <StatusPill status="late-risk">Store warned about {sent.reduce((n, s) => n + s.units, 0)} missing units</StatusPill>}

      {signed ? (
        <div className="rounded-lg bg-primary p-4 text-lg font-semibold text-primary-foreground">
          <Check className="mr-2 inline size-6" /> Signed off at {colombo(signed.signedAt)} · {trip.vehicleId} can leave
        </div>
      ) : (
        <SignOffButton tripId={tripId} vehicleId={trip.vehicleId} reefer={chilled} blockedReason={blockedReason} />
      )}
    </main>
  );
}

function Row({ ok, hatched, title, children }: { ok: boolean; hatched?: boolean; title: string; children?: React.ReactNode }) {
  return (
    <li className={cn("flex gap-3 rounded-lg border-2 p-3", hatched ? "hatch-violation" : "border-foreground bg-card")}>
      {ok ? <Check className="mt-0.5 size-6 shrink-0" /> : <Ban className="mt-0.5 size-6 shrink-0" />}
      <div className="min-w-0">
        <p className="text-lg font-semibold">{title}</p>
        <div className="text-base">{children}</div>
      </div>
    </li>
  );
}
