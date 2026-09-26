/** F6 route-leg scheduling and F7 departure time. */
import { first } from "./formulas";
import {
  DEPARTURE_PULLBACK_ATTEMPTS,
  DEPOT_DELAY_MIN,
  MIN_SERVICE_MIN,
  RISK_MARGIN_MIN,
  SERVICE_MODEL,
  TRAVEL_FACTOR,
} from "./params";
import { cmpStr, district, type Reference } from "./reference";
import type { DayContext, Leg, Order, TimeModel } from "./types";

export const PLANNED: TimeModel = "planned";
export const EXPECTED: TimeModel = "expected";

export function emptyContext(overrides: Partial<DayContext> = {}): DayContext {
  return { date: null, monsoon: 0, festivalRamp: 0, payday: 0, disruption: {}, ...overrides };
}

/** DayContext.for_date: calendar + road disruption for one date. */
export function contextForDate(R: Reference, day: string, disruption: Record<string, number>): DayContext {
  const c = R.calendar.get(day);
  if (!c) throw new Error(`calendar has no row for ${day}`);
  return { date: day, monsoon: c.monsoon, festivalRamp: c.festivalRamp, payday: c.isPayday, disruption };
}

/** G1: window close ascending, then window open, then outlet ID (then order ref). */
export function sequence(stops: readonly Order[]): Order[] {
  return [...stops].sort(
    (a, b) =>
      a.outlet.close - b.outlet.close ||
      a.outlet.open - b.outlet.open ||
      cmpStr(a.outletId, b.outletId) ||
      cmpStr(a.ref, b.ref),
  );
}

/** G6-G9. */
export function legMinutes(
  R: Reference,
  districtName: string,
  firstLeg: boolean,
  t: number,
  ctx: DayContext,
  model: TimeModel,
): number {
  const d = district(R, districtName);
  const base = firstLeg ? d.outboundMin : d.interStopMin; // G6
  if (model === PLANNED) return base; // G8
  const hour = Math.min(Math.floor(t / 60), 23); // G9
  return (
    base *
    (100 / R.speed(districtName, hour, ctx.monsoon)) *
    (100 / (ctx.disruption[districtName] ?? 100)) *
    TRAVEL_FACTOR
  );
}

/** G19 / G20 (P08, P14). */
export function serviceMinutes(R: Reference, order: Order, ctx: DayContext, model: TimeModel): number {
  if (model === PLANNED) return R.allowance(order.outlet.brand, order.outlet.dock); // G19
  const s = SERVICE_MODEL[order.outlet.brand]; // G20
  return Math.max(
    MIN_SERVICE_MIN,
    s.base[order.outlet.dock] + s.u * order.units + s.f * ctx.festivalRamp + s.p * ctx.payday + s.m * ctx.monsoon,
  );
}

/** F6: timed legs for one trip. keepOrder=true only to replay a recorded stop order. */
export function schedule(
  R: Reference,
  stopsIn: readonly Order[],
  departure: number,
  ctx: DayContext,
  model: TimeModel,
  keepOrder = false,
): { legs: Leg[]; back: number } {
  const stops = keepOrder ? [...stopsIn] : sequence(stopsIn); // G1
  let t = departure + (model === EXPECTED ? DEPOT_DELAY_MIN : 0); // G2-G4
  const legs: Leg[] = [];
  stops.forEach((o, k) => {
    // G5 / G23
    const travel = legMinutes(R, o.outlet.district, k === 0, t, ctx, model); // G6-G9
    const arrive = t + travel; // G10
    const slack = o.outlet.close - arrive;
    const late = arrive > o.outlet.close; // G11-G12
    const risk = model === EXPECTED && !late && slack < RISK_MARGIN_MIN; // G13-G14
    const start = Math.max(arrive, o.outlet.open); // G15-G17
    const svc = serviceMinutes(R, o, ctx, model); // G18-G20
    const leave = start + svc; // G21
    legs.push({
      ref: o.ref,
      outletId: o.outletId,
      depart: t,
      travel,
      arrive,
      wait: start - arrive,
      start,
      service: svc,
      leave,
      close: o.outlet.close,
      slack,
      late,
      risk,
    });
    t = leave; // G23
  });
  const last = stops[stops.length - 1];
  const back = t + (last ? legMinutes(R, last.outlet.district, true, t, ctx, model) : 0); // G24
  return { legs, back };
}

/** F7 for sequenced stops: reach the first stop as it opens, leave earlier only to keep the risk margin. */
export function departureTime(R: Reference, stops: readonly Order[], ready: number, ctx: DayContext): number {
  const f = first(stops);
  let t0 = Math.max(ready, f.outlet.open - district(R, f.outlet.district).outboundMin); // H1-H2
  for (let i = 0; i < DEPARTURE_PULLBACK_ATTEMPTS; i++) {
    // H3
    const { legs } = schedule(R, stops, t0, ctx, EXPECTED, true); // H4
    let shortfall = -Infinity;
    for (const leg of legs) shortfall = Math.max(shortfall, RISK_MARGIN_MIN - leg.slack); // H5
    if (shortfall <= 0 || t0 <= ready) break; // H6
    t0 = Math.max(ready, Math.floor(t0 - shortfall)); // H7
  }
  return t0; // H8
}
