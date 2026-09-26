/** F4 trip construction: commit the best whole trip each step, scarcest class first. */
import { bucketOf, splitBucket, sum, tripMinutes, tripMinutesOf, window, docks, first } from "./formulas";
import { byWeight, orderClass, weight } from "./eligibility";
import { CLASS_NAMES, MAX_TRIPS, TIME_BUDGET } from "./params";
import { capabilityCost, cmpStr, vehicle, type Reference } from "./reference";
import { roundTo } from "./time";
import { checkVehicleDay } from "./vehicle-day";
import type { DayContext, Mode, Order } from "./types";

export type Trips = Map<string, Order[][]>;
type Rank = [number, number, number, number];

/** Python tuple comparison `a > b`. */
function rankGreater(a: Rank, b: Rank): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i]! > b[i]!) return true;
    if (a[i]! < b[i]!) return false;
  }
  return false;
}

export function buildTrips(
  R: Reference,
  orders: Order[],
  eligible: Map<string, string[]>,
  fleet: string[],
  ctx: DayContext,
  mode: Mode,
  fuelUsed: Record<string, number>,
): { trips: Trips; open: Order[] } {
  const trips: Trips = new Map(fleet.map((v) => [v, [] as Order[][]]));
  let open = [...orders];
  const feasible = (v: string, day: Order[][]) => checkVehicleDay(R, v, day, ctx, mode, fuelUsed[v] ?? 0).ok;

  for (let c = 0; c < CLASS_NAMES.length; c++) {
    // D1 / D19-D20
    for (;;) {
      let best: { rank: Rank; v: string; cand: Order[] } | null = null; // D2
      for (const v of fleet) {
        // D3 (vehicle-ID order)
        const vTrips = trips.get(v)!;
        if (vTrips.length >= MAX_TRIPS) continue;
        const buckets = new Map<string, Order[]>();
        for (const o of open) {
          // D4
          if (orderClass(o) === c && eligible.get(o.ref)!.includes(v)) {
            const key = bucketOf(o);
            const list = buckets.get(key);
            if (list) list.push(o);
            else buckets.set(key, [o]);
          }
        }
        for (const key of [...buckets.keys()].sort(cmpStr)) {
          const cand: Order[] = []; // D5
          for (const o of [...buckets.get(key)!].sort(byWeight)) {
            // D6
            if (feasible(v, [...vTrips, [...cand, o]])) cand.push(o); // D7 -> D8
          }
          if (cand.length === 0) continue; // D11
          const [brand, districtName] = splitBucket(key);
          const minutes = tripMinutes(R, brand, districtName, docks(cand));
          const score = sum(cand.map(weight)) / minutes; // D12
          const spare =
            TIME_BUDGET[window(brand)] -
            minutes -
            sum(vTrips.filter((t) => window(first(t).outlet.brand) === window(brand)).map((t) => tripMinutesOf(R, t)));
          const veh = vehicle(R, v);
          const rank: Rank = [roundTo(score, 9), -capabilityCost(veh), -spare, -veh.capM3];
          // D13: ties keep lower ID, then bucket
          if (best === null || rankGreater(rank, best.rank)) best = { rank, v, cand }; // D14
        }
      }
      if (best === null) break; // D17
      trips.get(best.v)!.push(best.cand); // D18
      const taken = new Set(best.cand);
      open = open.filter((o) => !taken.has(o));
    }
  }
  return { trips, open };
}
