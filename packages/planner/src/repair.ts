/** F8 repair and deferral classification. */
import { bucketOf, first } from "./formulas";
import { byWeight, weight } from "./eligibility";
import { MAX_TRIPS } from "./params";
import type { Reference } from "./reference";
import { checkVehicleDay } from "./vehicle-day";
import type { Trips } from "./build";
import type { DayContext, Deferral, Mode, Order } from "./types";

function withTrip(tripsV: Order[][], i: number, newTrip: Order[]): Order[][] {
  return tripsV.map((t, j) => (j === i ? newTrip : t));
}

/** Python Counter.most_common(1): highest count, first inserted wins ties. */
function mostCommon(counts: Map<string, number>): string | null {
  let bestKey: string | null = null;
  let bestN = -1;
  for (const [k, n] of counts) {
    if (n > bestN) {
      bestKey = k;
      bestN = n;
    }
  }
  return bestKey;
}

/** F8. Mutates trips; returns order ref -> Deferral (unavoidable first, then the rest in open order). */
export function repairAndClassify(
  R: Reference,
  trips: Trips,
  openIn: Order[],
  eligible: Map<string, string[]>,
  unavoidable: Map<string, string>,
  ctx: DayContext,
  mode: Mode,
  fuelUsed: Record<string, number>,
): Map<string, Deferral> {
  const check = (v: string, day: Order[][]) => checkVehicleDay(R, v, day, ctx, mode, fuelUsed[v] ?? 0);
  const open = [...openIn];
  const removeFirst = (o: Order) => {
    const i = open.indexOf(o);
    if (i >= 0) open.splice(i, 1);
  };

  for (const o of [...open].sort(byWeight)) {
    // J1
    let placed = false;
    const oBucket = bucketOf(o);
    for (const v of eligible.get(o.ref)!) {
      // J2: vehicles by ID, trips in order
      const tv = trips.get(v)!;
      for (let i = 0; i < tv.length; i++) {
        const t = tv[i]!;
        if (bucketOf(first(t)) === oBucket && check(v, withTrip(tv, i, [...t, o])).ok) {
          trips.set(v, withTrip(tv, i, [...t, o]));
          placed = true;
          break;
        }
      }
      if (placed) break;
    }
    if (!placed) {
      // J4
      for (const v of eligible.get(o.ref)!) {
        const tv = trips.get(v)!;
        if (tv.length < MAX_TRIPS && check(v, [...tv, [o]]).ok) {
          trips.set(v, [...tv, [o]]);
          placed = true;
          break;
        }
      }
    }
    if (!placed) {
      // J5: swap out a lighter order
      outer: for (const v of eligible.get(o.ref)!) {
        const tv = trips.get(v)!;
        for (let i = 0; i < tv.length; i++) {
          const t = tv[i]!;
          if (bucketOf(first(t)) !== oBucket) continue;
          // Python sorted(t, key=weight): stable ascending by weight
          const lightest = t.map((q, idx) => ({ q, idx })).sort((a, b) => weight(a.q) - weight(b.q) || a.idx - b.idx);
          for (const { q } of lightest) {
            if (weight(q) >= weight(o)) break;
            const swapped = [...t.filter((x) => x !== q), o];
            if (check(v, withTrip(tv, i, swapped)).ok) {
              trips.set(v, withTrip(tv, i, swapped));
              open.push(q); // J6
              placed = true;
              break outer;
            }
          }
        }
      }
    }
    if (placed) removeFirst(o); // J3
  }

  const deferrals = new Map<string, Deferral>();
  for (const [ref, why] of unavoidable) deferrals.set(ref, { ref, kind: "UNAVOIDABLE", reason: why, lostTo: null });
  for (const o of open) {
    // J7-J9
    let lostTo: string | null = null;
    const failures = new Map<string, number>();
    const bump = (code: string | null) => {
      const k = code ?? "None";
      failures.set(k, (failures.get(k) ?? 0) + 1);
    };
    const oBucket = bucketOf(o);
    for (const v of eligible.get(o.ref)!) {
      const tv = trips.get(v)!;
      for (let i = 0; i < tv.length; i++) {
        const t = tv[i]!;
        if (bucketOf(first(t)) !== oBucket) continue;
        for (const q of t) {
          if (weight(q) >= weight(o) && check(v, withTrip(tv, i, [...t.filter((x) => x !== q), o])).ok) {
            lostTo = q.ref;
            break;
          }
        }
        if (lostTo) break;
        bump(check(v, withTrip(tv, i, [...t, o])).code);
      }
      if (lostTo) break;
      if (tv.length < MAX_TRIPS) bump(check(v, [...tv, [o]]).code);
      else bump("R7_TRIP_LIMIT");
    }
    if (lostTo) {
      deferrals.set(o.ref, { ref: o.ref, kind: "CHOSEN", reason: `lost to ${lostTo}`, lostTo }); // J8
    } else {
      deferrals.set(o.ref, { ref: o.ref, kind: "CAPACITY_FORCED", reason: mostCommon(failures) ?? "NO_SLOT", lostTo: null }); // J9
    }
  }
  return deferrals;
}
