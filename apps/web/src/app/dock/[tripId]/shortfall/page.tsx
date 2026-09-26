import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadList } from "@/lib/server/dock";
import { requireUser } from "@/lib/server/session";
import { ShortfallForm } from "./form";

export const metadata: Metadata = { title: "L-03 Flag shortfall" };

export default async function ShortfallPage({ params, searchParams }: PageProps<"/dock/[tripId]/shortfall">) {
  const user = await requireUser(["loader"]);
  const { tripId } = await params;
  const orderId = (await searchParams).order;
  const list = await loadList(tripId);
  if (!list || typeof orderId !== "string" || (user.depotId && list.trip.depotId !== user.depotId)) notFound();
  const stop = list.stops.find((s) => s.orderId === orderId);
  if (!stop) notFound();
  const loadIdx = [...list.stops].reverse().findIndex((s) => s.orderId === orderId) + 1;
  return (
    <ShortfallForm
      tripId={tripId}
      stop={{ orderId: stop.orderId, outletId: stop.outletId, seq: stop.seq, units: stop.units, temp: stop.temp }}
      trip={{ vehicleId: list.trip.vehicleId, code: list.trip.code, departureMin: list.trip.departureMin, chilled: list.stops.some((s) => s.temp === "chilled") }}
      loadIdx={loadIdx}
    />
  );
}
