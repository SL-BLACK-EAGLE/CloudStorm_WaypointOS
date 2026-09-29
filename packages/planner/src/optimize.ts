/**
 * Improvement pass after F4-F8 (optional local search in the master plan).
 *
 * planDay() is the flowchart algorithm, kept identical to the Python oracle. This pass starts from its
 * plan and only ever makes it better, in lexicographic order:
 *   1. serve more priority weight (fewer deferrals, never dropping a served order),
 *   2. then fewer trips (merge half-empty trips of the same brand and district).
 * Every candidate vehicle-day is re-checked with the full F5 rule set (checkVehicleDay), so the result
 * satisfies exactly the same rules as the baseline. It is deterministic: same input, same plan.
 */
import { byWeight, eligibleVehicles, weight, type StatusMap } from "./eligibility";
import { bucketOf, first, litres } from "./formulas";
import { MAX_TRIPS } from "./params";
import { timePlan } from "./plan";
import { capabilityCost, cmpStr, vehicle, type Reference } from "./reference";
import { checkVehicleDay } from "./vehicle-day";
import type { DayContext, Deferral, Mode, Order, Plan } from "./types";

export interface OptimizeMove {
  kind: "insert" | "eject" | "free-slot" | "merge";
  /** plain-language description for the dispatcher */
  detail: string;
  refs: string[];
}

export interface OptimizeStats {
  baseServed: number;
  served: number;
  baseWeight: number;
  servedWeight: number;
  baseTrips: number;
  trips: number;
  baseLitres: number;
  litres: number;
  moves: OptimizeMove[];
  rounds: number;
}

type Day = Order[][];

const cloneDay = (d: Day): Day => d.map((t) => [...t]);

export function optimizePlan(
  R: Reference,
  orders: Order[],
  status: StatusMap,
  ctx: DayContext,
  mode: Mode,
  fuelUsed: Record<string, number>,
  base: Plan,
  opts: { maxRounds?: number } = {},
): { plan: Plan; stats: OptimizeStats } {
  const fleet = Object.entries(status)
    .filter(([, s]) => s === "available")
    .map(([v]) => v)
    .sort(cmpStr);
  const days = new Map<string, Day>(fleet.map((v) => [v, cloneDay(base.trips.get(v) ?? [])]));
  const eligible = new Map(orders.map((o) => [o.ref, eligibleVehicles(R, o, status)]));
  const ok = (v: string, day: Day) => day.length <= MAX_TRIPS && checkVehicleDay(R, v, day.filter((t) => t.length > 0), ctx, mode, fuelUsed[v] ?? 0).ok;
  const hosts = (v: string, trip: Order[]) => trip.every((o) => eligible.get(o.ref)!.includes(v));
  const servedSet = () => new Set([...days.values()].flat(2));
  const stat = () => {
    const all = [...days.entries()].flatMap(([v, d]) => d.filter((t) => t.length).map((t) => ({ v, t })));
    return {
      served: all.reduce((n, x) => n + x.t.length, 0),
      weight: all.reduce((n, x) => n + x.t.reduce((m, o) => m + weight(o), 0), 0),
      trips: all.length,
      litres: all.reduce((n, x) => n + litres(R, x.t, x.v), 0),
    };
  };
  const before = stat();
  const moves: OptimizeMove[] = [];

  /** Where could `o` go without touching `avoid`? Existing same-bucket trip first, then a new trip. */
  const placement = (o: Order, avoid: Set<string>): { v: string; day: Day } | null => {
    const vs = eligible.get(o.ref)!.filter((v) => days.has(v) && !avoid.has(v));
    for (const v of vs) {
      const d = days.get(v)!;
      for (let i = 0; i < d.length; i++) {
        if (d[i]!.length && bucketOf(first(d[i]!)) === bucketOf(o)) {
          const next = d.map((t, j) => (j === i ? [...t, o] : t));
          if (ok(v, next)) return { v, day: next };
        }
      }
    }
    for (const v of vs) {
      const d = days.get(v)!.filter((t) => t.length);
      if (d.length < MAX_TRIPS && ok(v, [...d, [o]])) return { v, day: [...d, [o]] };
    }
    return null;
  };

  const tryInsert = (o: Order): boolean => {
    const p = placement(o, new Set());
    if (!p) return false;
    days.set(p.v, p.day);
    moves.push({ kind: "insert", detail: `${o.ref} (${o.outletId}) fits on ${p.v} after the other changes`, refs: [o.ref] });
    return true;
  };

  /** Ejection chain of length one: move a lighter order x off a trip to another vehicle so `o` takes its place. */
  const tryEject = (o: Order): boolean => {
    for (const v of eligible.get(o.ref)!) {
      const d = days.get(v);
      if (!d) continue;
      for (let i = 0; i < d.length; i++) {
        const t = d[i]!;
        if (!t.length || bucketOf(first(t)) !== bucketOf(o)) continue;
        for (const x of [...t].sort((a, b) => weight(a) - weight(b) || cmpStr(a.ref, b.ref))) {
          const mine = d.map((tt, j) => (j === i ? [...tt.filter((q) => q !== x), o] : tt));
          if (!ok(v, mine)) continue;
          const p = placement(x, new Set([v]));
          if (!p) continue;
          days.set(v, mine);
          days.set(p.v, p.day);
          moves.push({
            kind: "eject",
            detail: `${x.ref} (${x.outletId}) moved from ${v} to ${p.v}, which makes room for ${o.ref} (${o.outletId}) on ${v}`,
            refs: [o.ref, x.ref],
          });
          return true;
        }
      }
    }
    return false;
  };

  /**
   * Free a slot on a capable vehicle: hand one of its whole trips to another vehicle that can carry it
   * (cheapest capability first, e.g. an ambient trip off a reefer), then give `o` a trip there.
   */
  const tryFreeSlot = (o: Order): boolean => {
    for (const v of eligible.get(o.ref)!) {
      const d = days.get(v);
      if (!d) continue;
      const live = d.filter((t) => t.length);
      for (let j = 0; j < live.length; j++) {
        const trip = live[j]!;
        const rest = live.filter((_, k) => k !== j);
        const targets = fleet
          .filter((w) => w !== v && hosts(w, trip))
          .sort((a, b) => capabilityCost(vehicle(R, a)) - capabilityCost(vehicle(R, b)) || litres(R, trip, a) - litres(R, trip, b) || cmpStr(a, b));
        for (const w of targets) {
          const wd = days.get(w)!.filter((t) => t.length);
          if (wd.length >= MAX_TRIPS || !ok(w, [...wd, trip])) continue;
          // with the trip gone, o either joins a same-bucket trip on v or starts one
          const options: Day[] = [
            ...rest.map((t, k) => (bucketOf(first(t)) === bucketOf(o) ? rest.map((tt, m) => (m === k ? [...tt, o] : tt)) : null)).filter((x): x is Day => !!x),
            [...rest, [o]],
          ];
          const mine = options.find((opt) => ok(v, opt));
          if (!mine) continue;
          days.set(w, [...wd, trip]);
          days.set(v, mine);
          moves.push({
            kind: "free-slot",
            detail: `${w} takes ${v}'s ${first(trip).outlet.brand} ${first(trip).outlet.district} trip, so ${v} can carry ${o.ref} (${o.outletId})`,
            refs: [o.ref, ...trip.map((q) => q.ref)],
          });
          return true;
        }
      }
    }
    return false;
  };

  /** Merge two same-bucket trips when one vehicle can run both loads as one trip (fewer trips, less fuel). */
  const tryMerge = (): boolean => {
    const all = [...days.entries()].flatMap(([v, d]) => d.map((t, i) => ({ v, i, t })).filter((x) => x.t.length));
    for (let a = 0; a < all.length; a++) {
      for (let b = 0; b < all.length; b++) {
        const A = all[a]!;
        const B = all[b]!;
        if (a === b || bucketOf(first(A.t)) !== bucketOf(first(B.t))) continue;
        if (!hosts(A.v, B.t)) continue;
        const merged = [...A.t, ...B.t];
        const vd = days.get(A.v)!.map((t, i) => (i === A.i ? merged : A.v === B.v && i === B.i ? [] : t));
        const wd = A.v === B.v ? vd : days.get(B.v)!.map((t, i) => (i === B.i ? [] : t));
        if (!ok(A.v, vd) || (A.v !== B.v && !ok(B.v, wd))) continue;
        const saves = litres(R, A.t, A.v) + litres(R, B.t, B.v) - litres(R, merged, A.v);
        if (saves <= 0) continue;
        days.set(A.v, vd.filter((t) => t.length));
        if (A.v !== B.v) days.set(B.v, wd.filter((t) => t.length));
        moves.push({
          kind: "merge",
          detail: `${B.v}'s ${first(B.t).outlet.district} trip joins ${A.v}'s (one trip instead of two, ${saves.toFixed(1)} L less fuel)`,
          refs: B.t.map((q) => q.ref),
        });
        return true;
      }
    }
    return false;
  };

  let rounds = 0;
  const maxRounds = opts.maxRounds ?? 12;
  for (; rounds < maxRounds; rounds++) {
    let changed = false;
    const served = servedSet();
    const waiting = orders.filter((o) => !served.has(o) && eligible.get(o.ref)!.length > 0).sort(byWeight);
    for (const o of waiting) {
      if (servedSet().has(o)) continue;
      if (tryInsert(o) || tryEject(o) || tryFreeSlot(o)) changed = true;
    }
    while (tryMerge()) changed = true;
    if (!changed) break;
  }

  const trips = new Map([...days].map(([v, d]) => [v, d.filter((t) => t.length)] as const).filter(([, d]) => d.length > 0));
  const servedRefs = new Set([...servedSet()].map((o) => o.ref));
  const deferrals = new Map<string, Deferral>([...base.deferrals].filter(([ref]) => !servedRefs.has(ref)));
  const after = stat();
  return {
    plan: { mode, trips, deferrals, timed: timePlan(R, trips, ctx, mode, fuelUsed) },
    stats: {
      baseServed: before.served,
      served: after.served,
      baseWeight: before.weight,
      servedWeight: after.weight,
      baseTrips: before.trips,
      trips: after.trips,
      baseLitres: before.litres,
      litres: after.litres,
      moves,
      rounds: rounds + 1,
    },
  };
}
