/**
 * Golden-file parity: the TypeScript engine must reproduce the Python oracle's plans
 * exactly - the same trips, stop order, departures, every planned and expected leg,
 * and every deferral with its class and reason.
 */
import { describe, expect, it } from "vitest";
import { planDay } from "../src/plan";
import { EXPECTED, schedule } from "../src/schedule";
import { hhmmToMin } from "../src/time";
import { PLAN_NAMES, goldenPlan, hasGolden, orders, reference, routes } from "./fixtures";

const closeTo = (a: number | null, b: number | null) => {
  if (a === null || b === null) return expect(a).toBe(b);
  return expect(a).toBeCloseTo(b, 9);
};

describe.skipIf(!hasGolden)("parity with the Python oracle", () => {
  for (const name of PLAN_NAMES) {
    it(`reproduces plan ${name}`, () => {
      const g = goldenPlan(name);
      const R = reference();
      const plan = planDay(R, orders(g.orders), g.status, g.ctx, g.mode, g.fuelUsed);

      const trips = Object.fromEntries([...plan.trips].map(([v, ts]) => [v, ts.map((t) => t.map((o) => o.ref))]));
      expect(trips).toEqual(g.plan.trips);
      expect(Object.keys(trips)).toEqual(Object.keys(g.plan.trips));

      const deferrals = Object.fromEntries(
        [...plan.deferrals].map(([r, d]) => [r, { kind: d.kind, reason: d.reason, lostTo: d.lostTo }]),
      );
      expect(deferrals).toEqual(g.plan.deferrals);

      expect(plan.timed.length).toBe(g.plan.timed.length);
      plan.timed.forEach((t, i) => {
        const e = g.plan.timed[i]!;
        expect([t.vehicleId, t.number, t.stops.map((o) => o.ref)]).toEqual([e.vehicleId, e.number, e.stops]);
        closeTo(t.departure, e.departure);
        expect(t.tripMinutes).toBe(e.tripMinutes);
        closeTo(t.litres, e.litres);
        closeTo(t.backPlanned, e.backPlanned);
        closeTo(t.backExpected, e.backExpected);
        for (const [mine, theirs] of [
          [t.planned, e.planned],
          [t.expected, e.expected],
        ] as const) {
          expect(mine.length).toBe(theirs.length);
          mine.forEach((leg, k) => {
            const o = theirs[k]!;
            expect([leg.ref, leg.late, leg.risk, leg.close]).toEqual([o.ref, o.late, o.risk, o.close]);
            for (const f of ["depart", "travel", "arrive", "wait", "start", "service", "leave", "slack"] as const) {
              closeTo(leg[f], o[f]);
            }
          });
        }
      });
    });
  }

  it("reproduces EXPECTED legs on all 35 routes of the worst day in history (2025-03-15)", () => {
    const R = reference();
    const w = routes().worstDay;
    for (const r of w.routes) {
      const { legs } = schedule(R, orders(r.orders), hhmmToMin(r.departure), w.ctx, EXPECTED, true);
      legs.forEach((leg, k) => {
        closeTo(leg.arrive, r.expected[k]!.arrive);
        expect([leg.late, leg.risk]).toEqual([r.expected[k]!.late, r.expected[k]!.risk]);
      });
    }
  });
});
