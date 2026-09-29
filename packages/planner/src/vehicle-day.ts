/** F5 vehicle-day feasibility: every rule for one vehicle's whole day, in fixed order. */
import { bucketOf, first, litres, sum, tripMinutesOf, window } from "./formulas";
import { EARLIEST_DEPARTURE, MAX_TRIPS, RELOAD_MIN, TIME_BUDGET } from "./params";
import { vehicle, type Reference } from "./reference";
import { PLANNED, departureTime, schedule, sequence } from "./schedule";
import type { Check, DayContext, Mode, Order } from "./types";

export const MODE_2B: Mode = "2B";
export const MODE_LIVE: Mode = "LIVE";

/** Human-readable text for every F5 code, shown to dispatchers next to a blocked move. */
export const RULE_TEXT: Record<string, string> = {
  R7_TRIP_LIMIT: "A vehicle can run at most 2 trips a day",
  R1_BRAND_DISTRICT: "A trip carries one brand to one district",
  R2_R3_R4_VEHICLE_TYPE: "Wrong vehicle: chilled needs a reefer, van-only outlets need a van, and the vehicle must be from the outlet's depot",
  R6_WEIGHT: "Over the vehicle's weight limit",
  R6_VOLUME: "Over the vehicle's volume limit",
  R7_FRESH_BUDGET_270: "Fresh trips exceed the 270-minute pre-dawn budget (03:30–08:00)",
  R7_DAY_BUDGET_480: "Style and Tech trips exceed the 480-minute day budget",
  FUEL_QUOTA: "Not enough weekly fuel quota left for this vehicle",
  WINDOW_LATE: "A stop would arrive after its delivery window closes",
  TRIP2_WINDOW_LATE: "The second trip cannot reach its stops before their windows close",
};

/**
 * Rules a dispatcher may knowingly override with a written reason (audited): timing and fuel.
 * Physical rules - vehicle type (reefer/van/depot), weight, volume, one brand and district per trip,
 * two trips a day - can never be overridden.
 */
export const OVERRIDABLE_CODES: ReadonlySet<string> = new Set(["WINDOW_LATE", "TRIP2_WINDOW_LATE", "R7_FRESH_BUDGET_270", "R7_DAY_BUDGET_480", "FUEL_QUOTA"]);

/** Times an overridden vehicle-day the same way as E13-E19, without rejecting late stops. */
export function timeUnchecked(R: Reference, trips: Order[][], ctx: DayContext): Array<[Order[], number]> {
  const ordering = tripOrderings(trips.map((t) => sequence(t)))[0]!;
  const out: Array<[Order[], number]> = [];
  let ready: number | null = null;
  for (const stops of ordering) {
    const earliest = EARLIEST_DEPARTURE[first(stops).outlet.brand];
    const t0 = departureTime(R, stops, ready === null ? earliest : Math.max(earliest, ready), ctx);
    const { back } = schedule(R, stops, t0, ctx, PLANNED, true);
    out.push([stops, t0]);
    ready = back + RELOAD_MIN;
  }
  return out;
}

/** E13: Fresh trips before Style/Tech trips; two trips in the same window are tried both ways. */
function tripOrderings(seqs: Order[][]): Order[][][] {
  const fresh = seqs.filter((s) => first(s).outlet.brand === "Fresh");
  const day = seqs.filter((s) => first(s).outlet.brand !== "Fresh");
  const out = [[...fresh, ...day]];
  if (fresh.length === 2) out.push([...[...fresh].reverse(), ...day]);
  if (day.length === 2) out.push([...fresh, ...[...day].reverse()]);
  return out;
}

export function checkVehicleDay(
  R: Reference,
  vehicleId: string,
  trips: Order[][],
  ctx: DayContext,
  mode: Mode,
  fuelUsedL = 0,
): Check {
  const v = vehicle(R, vehicleId);
  if (trips.length > MAX_TRIPS) return { ok: false, code: "R7_TRIP_LIMIT", timed: null }; // E1 / X1
  const used = { Fresh: 0, Day: 0 };
  for (const trip of trips) {
    // E2
    const b = bucketOf(first(trip));
    if (trip.some((o) => bucketOf(o) !== b)) return { ok: false, code: "R1_BRAND_DISTRICT", timed: null }; // E3 / X2
    if (
      trip.some(
        (o) =>
          (o.temp === "chilled" && v.temp !== "reefer") ||
          (o.outlet.parking === "van_only" && v.type !== "van") ||
          o.outlet.depot !== v.depot,
      )
    ) {
      return { ok: false, code: "R2_R3_R4_VEHICLE_TYPE", timed: null }; // E4 / X3
    }
    if (sum(trip.map((o) => o.kg)) > v.capKg + 1e-9) return { ok: false, code: "R6_WEIGHT", timed: null }; // E5 / X4
    if (sum(trip.map((o) => o.m3)) > v.capM3 + 1e-9) return { ok: false, code: "R6_VOLUME", timed: null }; // E6 / X5
    used[window(first(trip).outlet.brand)] += tripMinutesOf(R, trip); // E7
  }
  if (used.Fresh > TIME_BUDGET.Fresh) return { ok: false, code: "R7_FRESH_BUDGET_270", timed: null }; // E9 / X6
  if (used.Day > TIME_BUDGET.Day) return { ok: false, code: "R7_DAY_BUDGET_480", timed: null }; // E10 / X7
  if (mode === MODE_2B) {
    return { ok: true, code: null, timed: trips.map((t) => [sequence(t), null]) }; // E11 / PASS1
  }
  if (sum(trips.map((t) => litres(R, t, vehicleId))) > v.weeklyQuotaL - fuelUsedL + 1e-9) {
    return { ok: false, code: "FUEL_QUOTA", timed: null }; // E12 / X8
  }
  let code = "WINDOW_LATE";
  for (const ordering of tripOrderings(trips.map((t) => sequence(t)))) {
    // E13 / E20
    let ready: number | null = null;
    const timed: Array<[Order[], number]> = [];
    let failed = false;
    for (let k = 0; k < ordering.length; k++) {
      const stops = ordering[k]!;
      const earliest = EARLIEST_DEPARTURE[first(stops).outlet.brand];
      const startFrom = ready === null ? earliest : Math.max(earliest, ready); // E14 / E19
      const t0 = departureTime(R, stops, startFrom, ctx); // E15
      const { legs, back } = schedule(R, stops, t0, ctx, PLANNED, true); // E16
      if (legs.some((leg) => leg.late)) {
        // E17
        code = k === 0 ? "WINDOW_LATE" : "TRIP2_WINDOW_LATE";
        failed = true;
        break;
      }
      timed.push([stops, t0]);
      ready = back + RELOAD_MIN; // E18 / E19
    }
    if (!failed) return { ok: true, code: null, timed }; // PASS2
  }
  return { ok: false, code, timed: null }; // X9
}
