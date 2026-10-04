"use client";

import { Camera, Loader2, Minus, Plus, Snowflake, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { hhmm } from "@/lib/format";
import { downscale, uploadImage } from "@/lib/image";
import { PageTour } from "@/components/wp/tour";
import { SHORTFALL_TOUR } from "@/lib/tours/loader";
import { cn } from "@/lib/utils";
import { flagShortfallAction } from "../../actions";

type Cause = "missing" | "damaged" | "not_cold";

/** L-03: the loader counts what is on the dock; the screen works out the gap. The dispatcher decides. */
export function ShortfallForm({
  tripId,
  stop,
  trip,
  loadIdx,
}: {
  tripId: string;
  stop: { orderId: string; outletId: string; seq: number; units: number; temp: string };
  trip: { vehicleId: string; code: string; departureMin: number | null; chilled: boolean };
  loadIdx: number;
}) {
  const router = useRouter();
  const [count, setCount] = useState(stop.units);
  const [cause, setCause] = useState<Cause>("missing");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<{ key: string; url: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const short = stop.units - count;
  const valid = cause === "missing" ? short > 0 : true;

  const onPhoto = async (f: File | undefined) => {
    if (!f) return;
    setUploading(true);
    try {
      const blob = await downscale(f);
      const key = await uploadImage(blob, "shortfall");
      setPhoto({ key, url: URL.createObjectURL(blob) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Photo upload failed");
    } finally {
      setUploading(false);
    }
  };

  const submit = () =>
    start(async () => {
      const f = new FormData();
      f.set("tripId", tripId);
      f.set("orderId", stop.orderId);
      f.set("unitsOnDock", String(count));
      f.set("cause", cause);
      if (note) f.set("note", note);
      if (photo) f.set("photoKey", photo.key);
      const r = await flagShortfallAction(f);
      if (r.ok) {
        toast.success(r.message);
        router.push(`/dock/${tripId}/sign-off`);
      } else toast.error(r.error);
    });

  return (
    <main className="mx-auto max-w-2xl space-y-5 p-4">
      <PageTour id="l03" steps={SHORTFALL_TOUR} large />
      <div>
        <h1 className="text-2xl font-bold">Flag a problem</h1>
        <p className="num text-lg">
          {stop.outletId} · load {loadIdx} · stop {stop.seq}
        </p>
        <p className="num flex items-center gap-1.5 text-base text-muted-foreground">
          {trip.vehicleId} · {trip.code} {trip.chilled && <Snowflake className="size-4" aria-label="chilled" />} · departs {hhmm(trip.departureMin)}
        </p>
      </div>

      <section className="space-y-2" data-tour="count">
        <h2 className="text-lg font-semibold">Units on the dock</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="icon-lg" variant="outline" className="size-16 shrink-0 border-2 border-foreground" onClick={() => setCount((c) => Math.max(0, c - 1))} aria-label="One less">
            <Minus className="size-7" />
          </Button>
          <input
            type="number"
            inputMode="numeric"
            value={count}
            onChange={(e) => setCount(Math.max(0, Math.min(stop.units * 2, Number(e.target.value) || 0)))}
            className="num h-16 w-28 min-w-0 rounded-lg border-2 border-foreground bg-card text-center text-4xl font-bold sm:w-32"
            aria-label="Units on the dock"
          />
          <Button size="icon-lg" variant="outline" className="size-16 shrink-0 border-2 border-foreground" onClick={() => setCount((c) => c + 1)} aria-label="One more">
            <Plus className="size-7" />
          </Button>
          <p className="basis-full text-lg sm:basis-auto">
            of <span className="num font-bold">{stop.units}</span> on the load list
          </p>
        </div>
        {short > 0 && <p className="num text-xl font-bold text-exception">{short} short</p>}
      </section>

      <section className="space-y-2" data-tour="cause">
        <h2 className="text-lg font-semibold">What&apos;s wrong</h2>
        <div className="grid grid-cols-3 gap-2" role="radiogroup">
          {(
            [
              ["missing", "Missing"],
              ["damaged", "Damaged"],
              ["not_cold", "Not cold"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              role="radio"
              aria-checked={cause === k}
              onClick={() => setCause(k)}
              className={cn("h-[72px] rounded-lg border-2 border-foreground text-lg font-semibold", cause === k && "bg-foreground text-background")}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2" data-tour="photo">
        <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onPhoto(e.target.files?.[0])} />
        {photo ? (
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.url} alt="Pallet label" className="h-24 w-32 rounded-md border-2 border-foreground object-cover" />
            <Button variant="outline" size="desk" onClick={() => setPhoto(null)}>
              <Trash2 /> Remove photo
            </Button>
          </div>
        ) : (
          <Button variant="outline" size="field" className="border-2 border-foreground" onClick={() => input.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="animate-spin" /> : <Camera />} Photo of the pallet label
          </Button>
        )}
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" rows={2} className="text-base" />
      </section>

      <section className="rounded-lg border-2 border-dashed p-4 text-base" data-tour="next">
        <h2 className="font-semibold">What happens next</h2>
        <p className="mt-1">Orders are never split. The dispatcher decides one of two things:</p>
        <ul className="mt-2 list-disc space-y-1 pl-6">
          <li>
            <strong>Hold {trip.vehicleId}</strong> until the units are found, or
          </li>
          <li>
            <strong>Send it now</strong> and warn the {stop.outletId} store before it arrives.
          </li>
        </ul>
        <p className="mt-2">Sign-off for {trip.vehicleId} stays locked until the dispatcher decides.</p>
      </section>

      <div className="grid gap-2 sm:grid-cols-2">
        <Button asChild size="hero" variant="outline" className="border-2 border-foreground">
          <Link href={`/dock/${tripId}`}>Cancel</Link>
        </Button>
        <Button size="hero" onClick={submit} disabled={!valid || pending || uploading} data-tour="submit">
          {pending && <Loader2 className="animate-spin" />}
          {cause === "missing" ? (short > 0 ? `Flag ${short} short` : "Count matches - nothing short") : `Flag ${cause === "damaged" ? "damaged" : "not cold"}`}
        </Button>
      </div>
    </main>
  );
}
