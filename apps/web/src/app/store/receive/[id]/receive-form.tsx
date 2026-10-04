"use client";

import { Camera, Check, Loader2, Minus, Plus, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatusPill, TempTag } from "@/components/wp/chips";
import { Panel, PanelHeader } from "@/components/wp/panel";
import { dayLabel, hhmm, kg } from "@/lib/format";
import { downscale, uploadImage } from "@/lib/image";
import { cn } from "@/lib/utils";
import { confirmReceiptAction } from "../../actions";
import { PageTour } from "@/components/wp/tour";
import { RECEIVE_TOUR } from "@/lib/tours/store";

type Kind = "damaged" | "missing" | "wrong_item" | "temperature";

/** SM-05: the store's count next to the driver's proof of delivery - a dispute compares two timestamped records. */
export function ReceiveForm({
  order,
  window: win,
  driver,
  receipt,
}: {
  order: {
    id: string;
    temp: "chilled" | "ambient";
    units: number;
    kg: number;
    runDate: string;
  };
  window: { open: number; close: number };
  driver: {
    status: string;
    vehicleId: string;
    tripCode: string;
    arrived: number | null;
    left: number | null;
    eta: number | null;
    unitsHanded: number | null;
    recipient: string | null;
    signatureKey: string | null;
    photoKey: string | null;
  } | null;
  receipt: {
    status: string;
    units: number;
    note: string | null;
    issues: Array<{
      kind: string;
      units: number;
      note: string | null;
      photoKey: string | null;
    }>;
  } | null;
}) {
  const [units, setUnits] = useState(driver?.unitsHanded ?? order.units);
  const [problem, setProblem] = useState(false);
  const [damaged, setDamaged] = useState(0);
  const [missing, setMissing] = useState(Math.max(0, order.units - (driver?.unitsHanded ?? order.units)));
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<{ key: string; url: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, start] = useTransition();
  const file = useRef<HTMLInputElement>(null);
  const delivered = driver?.status === "delivered";
  // a short count is a problem by definition: open the problem section with the gap as missing units
  const changeUnits = (n: number) => {
    const next = Math.max(0, Math.min(order.units, n));
    setUnits(next);
    if (next < order.units) {
      setProblem(true);
      setMissing(order.units - next);
    } else setMissing(0);
  };

  if (receipt) {
    return (
      <main>
        <Panel className="mx-auto max-w-xl space-y-3 p-6">
          <StatusPill status={receipt.status === "problem" ? "exception" : "delivered"}>
            {receipt.status === "problem" ? "Confirmed with a problem" : "Received in full"}
          </StatusPill>
          <h1 className="text-xl font-semibold">
            {order.id} · {receipt.units} of {order.units} units received
          </h1>
          <ul className="space-y-1 text-sm">
            {receipt.issues.map((i, k) => (
              <li key={k}>
                {i.units} {i.kind.replace("_", " ")}
              </li>
            ))}
          </ul>
          {receipt.note && <p className="text-sm text-muted-foreground">&ldquo;{receipt.note}&rdquo;</p>}
          {[...new Set(receipt.issues.map((i) => i.photoKey).filter(Boolean))].map((k) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={k} src={`/api/files/${k}`} alt="Photo sent to the dispatcher" className="h-32 rounded-md border object-cover" />
          ))}
          <Button asChild size="desk" variant="outline">
            <Link href="/store/receive">Back</Link>
          </Button>
        </Panel>
      </main>
    );
  }

  const submit = () =>
    start(async () => {
      const issues: Array<{
        kind: Kind;
        units: number;
        note?: string;
        photoKey?: string;
      }> = [];
      if (problem && damaged > 0) issues.push({ kind: "damaged", units: damaged, photoKey: photo?.key });
      if (problem && missing > 0) issues.push({ kind: "missing", units: missing, photoKey: photo?.key });
      const r = await confirmReceiptAction({
        orderId: order.id,
        unitsReceived: units,
        issues,
        note: note || undefined,
      });
      if (r.ok) toast.success(r.message);
      else toast.error(r.error);
    });

  return (
    <main className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <PageTour id="sm05" steps={RECEIVE_TOUR} />
      <Panel className="space-y-5 p-5">
        <div>
          <h1 className="text-xl font-semibold">Receive {order.temp === "chilled" ? "chilled" : "dry"} order</h1>
          <p className="num text-sm text-muted-foreground">
            {order.id} · {dayLabel(order.runDate)} · {kg(order.kg)}
          </p>
          <p className="mt-1 text-sm">Check what arrived before you confirm. Problems go to the dispatcher straight away.</p>
        </div>
        {!delivered && (
          <p className="rounded-md border border-dashed p-3 text-sm">
            The driver has not recorded this delivery yet
            {driver?.eta ? ` - expected around ${hhmm(driver.eta)}` : ""}. You can confirm once it arrives.
          </p>
        )}
        <section className="space-y-2" data-tour="units">
          <h2 className="font-semibold">1 · Units received</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="icon-lg" variant="outline" onClick={() => changeUnits(units - 1)} aria-label="One less">
              <Minus />
            </Button>
            <input
              value={units}
              onChange={(e) => changeUnits(Number(e.target.value) || 0)}
              inputMode="numeric"
              className="num h-12 w-24 min-w-0 rounded-md border text-center text-2xl font-semibold sm:w-28"
              aria-label="Units received"
            />
            <Button size="icon-lg" variant="outline" onClick={() => changeUnits(units + 1)} aria-label="One more">
              <Plus />
            </Button>
            <span className="text-sm">of {order.units} expected</span>
          </div>
        </section>
        <section className="space-y-2" data-tour="anything-wrong">
          <h2 className="font-semibold">2 · Anything wrong?</h2>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setProblem(false)}
              className={cn("h-12 rounded-md border text-sm font-medium", !problem && "border-foreground bg-foreground text-background")}
            >
              All arrived in good condition
            </button>
            <button
              onClick={() => setProblem(true)}
              className={cn("h-12 rounded-md border text-sm font-medium", problem && "border-exception bg-exception-bg text-exception")}
            >
              Report a problem
            </button>
          </div>
        </section>
        {problem && (
          <section className="space-y-3 rounded-lg border border-exception-border p-4">
            <h2 className="font-semibold">3 · What&apos;s wrong</h2>
            {(
              [
                ["Damaged units", damaged, setDamaged],
                ["Missing units", missing, setMissing],
              ] as const
            ).map(([label, v, setV]) => (
              <div key={label} className="flex items-center gap-2">
                <span className="w-36 text-sm">{label}</span>
                <Button size="icon" variant="outline" onClick={() => setV(Math.max(0, v - 1))} aria-label={`Less ${label}`}>
                  <Minus />
                </Button>
                <span className="num w-10 text-center font-semibold">{v}</span>
                <Button size="icon" variant="outline" onClick={() => setV(Math.min(order.units, v + 1))} aria-label={`More ${label}`}>
                  <Plus />
                </Button>
              </div>
            ))}
            <input
              ref={file}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setUploading(true);
                try {
                  const blob = await downscale(f);
                  setPhoto({
                    key: await uploadImage(blob, "receipt"),
                    url: URL.createObjectURL(blob),
                  });
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Upload failed");
                } finally {
                  setUploading(false);
                }
              }}
            />
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo.url} alt="Damage" className="h-28 w-40 rounded-md border object-cover" />
            ) : (
              <Button size="desk" variant="outline" onClick={() => file.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 className="animate-spin" /> : <Camera />} Add photo{" "}
                {damaged > 0 && <span className="text-exception">(required for damage)</span>}
              </Button>
            )}
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" rows={2} />
            {missing !== order.units - units && (
              <p className="text-[13px] text-late-risk">
                You counted {units} of {order.units}, so {order.units - units} should be missing. Damaged units count as received.
              </p>
            )}
            <p className="text-[13px] text-muted-foreground">
              Your count is matched against the driver&apos;s proof of delivery. Any difference goes to the dispatcher with your photo.
            </p>
          </section>
        )}
        <Button
          size="field"
          data-tour="confirm"
          disabled={
            !delivered ||
            pending ||
            uploading ||
            (problem && damaged > 0 && !photo) ||
            (problem && damaged + missing === 0) ||
            (problem && missing !== order.units - units)
          }
          className={cn(problem && "bg-exception text-white hover:bg-exception/90")}
          onClick={submit}
        >
          {pending ? <Loader2 className="animate-spin" /> : problem ? <TriangleAlert /> : <Check />}
          {problem ? "Confirm with problem" : `Confirm ${units} of ${order.units} received`}
        </Button>
      </Panel>

      <aside className="space-y-4">
        <Panel data-tour="driver-record">
          <PanelHeader title="Driver's record" aside={delivered ? <StatusPill status="delivered" /> : undefined} />
          {driver ? (
            <dl className="grid grid-cols-[7rem_1fr] gap-y-2 p-4 text-sm">
              <dt className="text-muted-foreground">Vehicle</dt>
              <dd className="num">
                {driver.vehicleId} · {driver.tripCode}
              </dd>
              <dt className="text-muted-foreground">Arrived</dt>
              <dd className="num">{hhmm(driver.arrived)}</dd>
              <dt className="text-muted-foreground">Handed over</dt>
              <dd className="num">{hhmm(driver.left)}</dd>
              <dt className="text-muted-foreground">Window</dt>
              <dd className="num">
                {driver.arrived !== null
                  ? driver.arrived <= win.close
                    ? `Inside, ${Math.round(win.close - driver.arrived)} min before ${hhmm(win.close)}`
                    : `${Math.round(driver.arrived - win.close)} min after ${hhmm(win.close)}`
                  : "—"}
              </dd>
              <dt className="text-muted-foreground">Units</dt>
              <dd className="num">{driver.unitsHanded ?? "—"}</dd>
              <dt className="text-muted-foreground">Received by</dt>
              <dd>{driver.recipient ?? "—"}</dd>
              {(driver.signatureKey || driver.photoKey) && (
                <>
                  <dt className="text-muted-foreground">Proof</dt>
                  <dd>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/files/${driver.signatureKey ?? driver.photoKey}`}
                      alt="Proof of delivery"
                      className="h-20 rounded border bg-white object-contain p-1"
                    />
                  </dd>
                </>
              )}
            </dl>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">Not on a published plan yet.</p>
          )}
        </Panel>
        <TempTag temp={order.temp} />
      </aside>
    </main>
  );
}
