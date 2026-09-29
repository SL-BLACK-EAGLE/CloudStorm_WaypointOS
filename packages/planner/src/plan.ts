/** M master flow: one planning run, plus publish / dock / end-of-day helpers (M16-M23). */
import { buildTrips, type Trips } from "./build";
import { eligibleVehicles, unavoidableReason, type StatusMap } from "./eligibility";
import { first, litres, tripMinutesOf } from "./formulas";
import { cmpStr, type Reference } from "./reference";
import { EXPECTED, PLANNED, schedule } from "./schedule";
import { repairAndClassify } from "./repair";
import { MODE_LIVE, OVERRIDABLE_CODES, checkVehicleDay, timeUnchecked } from "./vehicle-day";
import type { DayContext, Mode, Order, Plan, TimedTrip } from "./types";

/** M3-M15: eligibility -> weight -> trip construction -> repair -> timed plan ready to publish. */
export function planDay(
  R: Reference,
  orders: Order[],
  status: StatusMap,
  ctx: DayContext,
  mode: Mode = MODE_LIVE,
  fuelUsed: Record<string, number> = {},
): Plan {
  const fleet = Object.entries(status)
    .filter(([, s]) => s === "available")
    .map(([v]) => v)
    .sort(cmpStr);
  const eligible = new Map<string, string[]>();
  const unavoidable = new Map<string, string>();
  for (const o of orders) {
    // M9
    const e = eligibleVehicles(R, o, status);
    eligible.set(o.ref, e);
    if (e.length === 0) unavoidable.set(o.ref, unavoidableReason(R, o, status)); // M10 -> M11
  }
  const candidates = orders.filter((o) => !unavoidable.has(o.ref)); // M12
  const built = buildTrips(R, candidates, eligible, fleet, ctx, mode, fuelUsed); // M13
  const deferrals = repairAndClassify(R, built.trips, built.open, eligible, unavoidable, ctx, mode, fuelUsed); // M14
  const trips: Trips = new Map([...built.trips].filter(([, t]) => t.length > 0));
  return { mode, trips, deferrals, timed: timePlan(R, trips, ctx, mode, fuelUsed) }; // M15
}

/** Departure, PLANNED and EXPECTED legs for every trip, in driving order. */
export function timePlan(
  R: Reference,
  trips: Trips,
  ctx: DayContext,
  mode: Mode,
  fuelUsed: Record<string, number> = {},
  /** vehicles whose timing/fuel rule the dispatcher overrode with a reason */
  overridden: ReadonlySet<string> = new Set(),
): TimedTrip[] {
  const out: TimedTrip[] = [];
  for (const [v, ts] of [...trips].sort((a, b) => cmpStr(a[0], b[0]))) {
    const chk = checkVehicleDay(R, v, ts, ctx, mode, fuelUsed[v] ?? 0);
    let timed = chk.timed;
    if (!chk.ok && mode === MODE_LIVE && overridden.has(v) && OVERRIDABLE_CODES.has(chk.code ?? "")) timed = timeUnchecked(R, ts, ctx);
    else if (!chk.ok || !timed) throw new Error(`vehicle ${v} fails ${chk.code} at publish time`);
    timed!.forEach(([stops, t0], k) => {
      const tt: TimedTrip = {
        vehicleId: v,
        number: k + 1,
        stops,
        departure: t0,
        tripMinutes: tripMinutesOf(R, stops),
        litres: litres(R, stops, v),
        planned: [],
        backPlanned: null,
        expected: [],
        backExpected: null,
      };
      if (t0 !== null) {
        const p = schedule(R, stops, t0, ctx, PLANNED, true);
        const e = schedule(R, stops, t0, ctx, EXPECTED, true);
        tt.planned = p.legs;
        tt.backPlanned = p.back;
        tt.expected = e.legs;
        tt.backExpected = e.back;
      }
      out.push(tt);
    });
  }
  return out;
}

/** order ref -> [vehicle, trip number in driving order]. */
export function servedMap(plan: Plan): Map<string, [string, number]> {
  const m = new Map<string, [string, number]>();
  for (const t of plan.timed) for (const o of t.stops) m.set(o.ref, [t.vehicleId, t.number]);
  return m;
}

/** M16: last stop is loaded first. */
export function loadList(trip: TimedTrip): string[] {
  return [...trip.stops].reverse().map((o) => o.ref);
}

export type DockDecision = "HOLD" | "SEND_AND_WARN";

/** M19-M21: sign-off stays locked while a shortfall has no dispatcher decision. */
export function dockSignoff(openShortfalls: number, decision: DockDecision | null): string {
  if (openShortfalls === 0) return "RELEASED";
  return decision === null ? "LOCKED" : `RELEASED_${decision}`;
}

/** M23: deferred orders join the next run with deferredYesterday = 1. */
export function carryOver(plan: Plan, orders: Order[]): Order[] {
  // an order bigger than every vehicle is not carried: the store has to split it (F1 A5)
  return orders
    .filter((o) => plan.deferrals.has(o.ref) && plan.deferrals.get(o.ref)!.reason !== "EXCEEDS_EVERY_VEHICLE")
    .map((o) => ({ ...o, deferredYesterday: 1, daysSinceLastServed: o.daysSinceLastServed + 1 }));
}

export function tripBrand(trip: Order[]): string {
  return first(trip).outlet.brand;
}
