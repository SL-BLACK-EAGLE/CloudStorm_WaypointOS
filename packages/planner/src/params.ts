/**
 * Planning parameters P01-P23 (flowchart section 2).
 *
 * Every value comes from the supplied dataset unless it is marked ASSUMPTION or POLICY.
 * Mirrors tools/planner-oracle/params.py exactly; the parity tests fail if they drift.
 */
import type { Brand, Dock } from "./types";

/** P01, P02 earliest planned departures seen in route_legs_train.csv (minutes after midnight). */
export const EARLIEST_DEPARTURE: Record<Brand, number> = { Fresh: 2 * 60, Style: 7 * 60 + 30, Tech: 7 * 60 + 30 };

/** P03, P04 booklet rule 7. "Day" = Style and Tech trips combined. */
export const TIME_BUDGET = { Fresh: 270, Day: 480 } as const;

/** P05 booklet rule 7. */
export const MAX_TRIPS = 2;

/** P16 ASSUMPTION: dock turnaround between a vehicle's trips. */
export const RELOAD_MIN = 30;

/** P12 mean(actual - planned first departure) = 7.7 min. */
export const DEPOT_DELAY_MIN = 8;

/** P13 actual travel = planned x 100/speed x 100/disruption x factor. */
export const TRAVEL_FACTOR = 1.0;

/** P15 flag late risk when expected arrival is within 20 min of window close. */
export const RISK_MARGIN_MIN = 20;

/** P18 orders close at 16:00 on the operating day before the run. */
export const CUTOFF_MIN = 16 * 60;

/** P14 expected service minutes = base[dock] + u*units + f*festival_ramp + p*payday + m*monsoon. */
export const SERVICE_MODEL: Record<Brand, { base: Record<Dock, number>; u: number; f: number; p: number; m: number }> = {
  Fresh: { base: { rear_dock: 3.9, street: 7.5, mall_bay: 7.5 }, u: 0.178, f: 13.9, p: 5.1, m: 3.1 },
  Style: { base: { rear_dock: -4.0, street: 14.6, mall_bay: 31.0 }, u: 0.724, f: 43.8, p: 14.2, m: 7.7 },
  Tech: { base: { rear_dock: 5.7, street: 22.7, mall_bay: 34.0 }, u: 7.605, f: 43.2, p: 16.7, m: 6.9 },
};
export const MIN_SERVICE_MIN = 3;

/** P19 POLICY: no repeat deferral >> days unserved >> perishable >> volume. */
export const WEIGHT_DEFERRED_YESTERDAY = 1000;
export const WEIGHT_PER_DAY_UNSERVED = 20;
export const WEIGHT_CHILLED = 10;
export const WEIGHT_PER_M3 = 1;

/** P20 scarcest resource first. */
export const CLASS_NAMES = ["van-only chilled", "chilled", "van-only ambient", "everything else"] as const;

/** P21 never spend a reefer or a van on what a plain truck can carry. */
export const CAPABILITY_COST = { reefer: 2, van: 1 } as const;

/** P22 p90 of depot departure delay. */
export const NOT_DEPARTED_AFTER_MIN = 15;

/** P23 p90 of (actual - expected service) = 9.7 min. */
export const LONG_STOP_EXTRA_MIN = 10;

/** Pull-back attempts in F7 (flowchart node H6). */
export const DEPARTURE_PULLBACK_ATTEMPTS = 3;
