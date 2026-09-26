/** Shared formulas (P06, P17) and order accessors. */
import { district, vehicle, type Reference } from "./reference";
import type { Brand, Dock, Order, Window } from "./types";

export function window(brand: Brand): Window {
  return brand === "Fresh" ? "Fresh" : "Day";
}

/** P06 booklet budget formula = check_allocation.py: outbound + (stops-1) x inter-stop + sum of allowances. */
export function tripMinutes(R: Reference, brand: Brand, districtName: string, docks: Dock[]): number {
  const d = district(R, districtName);
  let handling = 0;
  for (const k of docks) handling += R.allowance(brand, k);
  return d.outboundMin + (docks.length - 1) * d.interStopMin + handling;
}

/** P17 fuel for one trip, return leg included. */
export function litres(R: Reference, trip: Order[], vehicleId: string): number {
  const d = district(R, first(trip).outlet.district);
  return (2 * d.depotKm + (trip.length - 1) * d.interStopKm) / vehicle(R, vehicleId).kmPerL;
}

/** (brand, district) bucket as a sortable key; the NUL separator keeps tuple ordering. */
export function bucketOf(o: Order): string {
  return `${o.outlet.brand}\u0000${o.outlet.district}`;
}

export function splitBucket(key: string): [Brand, string] {
  const [brand, d] = key.split("\u0000") as [Brand, string];
  return [brand, d];
}

export function docks(trip: Order[]): Dock[] {
  return trip.map((o) => o.outlet.dock);
}

export function tripMinutesOf(R: Reference, trip: Order[]): number {
  const o = first(trip);
  return tripMinutes(R, o.outlet.brand, o.outlet.district, docks(trip));
}

export function first<T>(xs: readonly T[]): T {
  const x = xs[0];
  if (x === undefined) throw new Error("empty list");
  return x;
}

export function sum(xs: Iterable<number>): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}
