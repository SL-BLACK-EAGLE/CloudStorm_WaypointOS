/** F9 live operations and offline sync. */
import { LONG_STOP_EXTRA_MIN, NOT_DEPARTED_AFTER_MIN, RISK_MARGIN_MIN } from "./params";
import type { Reference } from "./reference";
import { EXPECTED, legMinutes, serviceMinutes } from "./schedule";
import type { DayContext, Eta, Order } from "./types";

/**
 * K6: EXPECTED times for the remaining stops from the last actual time (no depot delay).
 * stops in driving order; done = [actual arrive, actual leave] of completed stops;
 * now = actual departure if none done.
 */
export function rescheduleRemaining(
  R: Reference,
  stops: readonly Order[],
  done: ReadonlyArray<readonly [number, number]>,
  now: number,
  ctx: DayContext,
): Eta[] {
  let t = done.length ? done[done.length - 1]![1] : now;
  const etas: Eta[] = [];
  for (let k = done.length; k < stops.length; k++) {
    const o = stops[k]!;
    const arrive = t + legMinutes(R, o.outlet.district, k === 0, t, ctx, EXPECTED);
    etas.push({
      ref: o.ref,
      outletId: o.outletId,
      eta: arrive,
      close: o.outlet.close,
      risk: arrive > o.outlet.close - RISK_MARGIN_MIN,
      late: arrive > o.outlet.close,
    });
    t = Math.max(arrive, o.outlet.open) + serviceMinutes(R, o, ctx, EXPECTED);
  }
  return etas;
}

/** K10 (P22): fires once 15 minutes have passed since the planned departure. */
export function notDeparted(plannedDeparture: number, now: number, departed: boolean): boolean {
  return !departed && now >= plannedDeparture + NOT_DEPARTED_AFTER_MIN;
}

/** K11 (P23): the service clock starts at the later of arrival and window open. */
export function longStopAlarmTime(R: Reference, order: Order, arrive: number, ctx: DayContext): number {
  return Math.max(arrive, order.outlet.open) + serviceMinutes(R, order, ctx, EXPECTED) + LONG_STOP_EXTRA_MIN;
}

/** K12 dead reckoning while a vehicle is silent: probable position + ETAs from the last known fact. */
export function projectPosition(
  R: Reference,
  stops: readonly Order[],
  done: ReadonlyArray<readonly [number, number]>,
  now: number,
  ctx: DayContext,
): { where: string; etas: Eta[] } {
  const etas = rescheduleRemaining(R, stops, done, now, ctx);
  for (let i = 0; i < etas.length; i++) {
    const e = etas[i]!;
    const o = stops[done.length + i]!;
    if (now < e.eta) return { where: `driving to ${o.outletId}`, etas };
    if (now < Math.max(e.eta, o.outlet.open) + serviceMinutes(R, o, ctx, EXPECTED)) return { where: `at ${o.outletId}`, etas };
  }
  return { where: "returning to depot", etas };
}

export type SyncOutcome = "IGNORE_DUPLICATE" | "APPLY_FACT_KEEP_RECORDED_TIME" | "APPLY_FACT_KEEP_RECORDED_TIME + RAISE_CONFLICT";

/** Q1-Q6. event = {uuid, stop, baseVersion}; planVersion = stop -> current version. */
export function syncEvent(
  applied: Set<string>,
  planVersion: Record<string, number>,
  event: { uuid: string; stop: string; baseVersion: number },
): SyncOutcome {
  if (applied.has(event.uuid)) return "IGNORE_DUPLICATE"; // Q2
  applied.add(event.uuid); // Q3
  if ((planVersion[event.stop] ?? event.baseVersion) !== event.baseVersion) {
    return "APPLY_FACT_KEEP_RECORDED_TIME + RAISE_CONFLICT"; // Q6
  }
  return "APPLY_FACT_KEEP_RECORDED_TIME"; // Q5
}
