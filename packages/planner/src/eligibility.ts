/** F2 eligibility (order x vehicle) and F3 priority weight and class. */
import { tripMinutes, window } from "./formulas";
import {
  TIME_BUDGET,
  WEIGHT_CHILLED,
  WEIGHT_DEFERRED_YESTERDAY,
  WEIGHT_PER_DAY_UNSERVED,
  WEIGHT_PER_M3,
} from "./params";
import { cmpStr, vehicle, type Reference } from "./reference";
import type { Order } from "./types";

export type StatusMap = Record<string, string>;

/** B1-B7 in fixed order. null = eligible, otherwise the first failing code. */
export function checkVehicle(R: Reference, order: Order, vehicleId: string, status: StatusMap): string | null {
  const v = vehicle(R, vehicleId);
  if (status[vehicleId] !== "available") return "IN_WORKSHOP"; // B1
  if (v.depot !== order.outlet.depot) return "WRONG_DEPOT"; // B2
  if (order.temp === "chilled" && v.temp !== "reefer") return "NEEDS_REEFER"; // B3
  if (order.outlet.parking === "van_only" && v.type !== "van") return "NEEDS_VAN"; // B4
  if (order.kg > v.capKg) return "OVER_WEIGHT"; // B5
  if (order.m3 > v.capM3) return "OVER_VOLUME"; // B6
  if (
    tripMinutes(R, order.outlet.brand, order.outlet.district, [order.outlet.dock]) >
    TIME_BUDGET[window(order.outlet.brand)]
  ) {
    return "OVER_TIME_BUDGET"; // B7
  }
  return null; // BOK
}

/** BL loop over the depot's vehicles, in vehicle-ID order. */
export function eligibleVehicles(R: Reference, order: Order, status: StatusMap): string[] {
  return R.vehicleIds.filter(
    (vid) => vehicle(R, vid).depot === order.outlet.depot && checkVehicle(R, order, vid, status) === null,
  );
}

/** R1-R5, asked only when no vehicle is eligible. */
export function unavoidableReason(R: Reference, order: Order, status: StatusMap): string {
  const depot = [...R.vehicles.values()].filter((v) => v.depot === order.outlet.depot);
  const avail = depot.filter((v) => status[v.id] === "available");
  if (!depot.some((v) => order.kg <= v.capKg && order.m3 <= v.capM3)) return "EXCEEDS_EVERY_VEHICLE"; // R1
  if (order.temp === "chilled" && !avail.some((v) => v.temp === "reefer")) return "NO_REEFER_AVAILABLE"; // R2
  if (order.outlet.parking === "van_only" && !avail.some((v) => v.type === "van")) return "NO_VAN_AVAILABLE"; // R3
  if (
    order.temp === "chilled" &&
    order.outlet.parking === "van_only" &&
    !avail.some((v) => v.type === "van" && v.temp === "reefer")
  ) {
    return "NO_REEFER_VAN_AVAILABLE"; // R4
  }
  return "NO_VEHICLE_FITS_ORDER"; // R5
}

/** C1 (P19). */
export function weight(order: Order): number {
  return (
    WEIGHT_DEFERRED_YESTERDAY * order.deferredYesterday +
    WEIGHT_PER_DAY_UNSERVED * order.daysSinceLastServed +
    WEIGHT_CHILLED * (order.temp === "chilled" ? 1 : 0) +
    WEIGHT_PER_M3 * order.m3
  );
}

/** C2-C8 (P20): 0 van-only chilled, 1 chilled, 2 van-only ambient, 3 everything else. */
export function orderClass(order: Order): number {
  if (order.temp === "chilled") return order.outlet.parking === "van_only" ? 0 : 1;
  return order.outlet.parking === "van_only" ? 2 : 3;
}

/** C9: heaviest first, then order ref. */
export function byWeight(a: Order, b: Order): number {
  const wa = -weight(a);
  const wb = -weight(b);
  return wa < wb ? -1 : wa > wb ? 1 : cmpStr(a.ref, b.ref);
}
