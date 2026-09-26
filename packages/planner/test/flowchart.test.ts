/**
 * Flowchart test cases TC-01..TC-38 (docs/delivery-planning-flowchart.md, section 14.3),
 * ported one-to-one from tools/planner-oracle/tests/test_cases.py. Each test names the
 * chart nodes it walks through, so a failure points at a box in the flowchart.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { checkVehicle, unavoidableReason, weight } from "../src/eligibility";
import { litres, tripMinutes } from "../src/formulas";
import { intake } from "../src/intake";
import { longStopAlarmTime, notDeparted, projectPosition, rescheduleRemaining, syncEvent } from "../src/live";
import { carryOver, dockSignoff, loadList, planDay, servedMap } from "../src/plan";
import { makeOrder } from "../src/reference";
import { EXPECTED, PLANNED, departureTime, emptyContext, schedule, sequence, serviceMinutes } from "../src/schedule";
import { hhmmToMin as m, minToHhmm as hm } from "../src/time";
import { MODE_2B, MODE_LIVE, checkVehicleDay } from "../src/vehicle-day";
import type { Order, Plan, Temp } from "../src/types";
import { GOLDEN_DIR, hasGolden, orders, reference, routes, s1 } from "./fixtures";

const r1 = (x: number) => Math.round(x * 10) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

describe.skipIf(!hasGolden)("flowchart test cases", () => {
  const R = () => reference();
  const o = (ref: string, outlet: string, temp: Temp = "ambient", units = 30, kg = 200.0, m3 = 1.0): Order =>
    makeOrder(R(), { ref, outletId: outlet, temp, units, kg, m3 });
  const route = (id: string) => orders(routes().routes[id]!.orders);
  const dec23 = () => routes().routes["R023442"]!.ctx;
  let S: ReturnType<typeof s1>;
  let plans: Record<"2B" | "LIVE", Plan>;

  beforeAll(() => {
    S = s1();
    plans = {
      "2B": planDay(R(), S.list, S.status, S.ctx, MODE_2B),
      LIVE: planDay(R(), S.list, S.status, S.ctx, MODE_LIVE),
    };
  });

  // ------------------------------------------------------------------ F1 intake and cutoff
  it("TC-01 on-time order: A1 -> A4 -> A6 -> A8 -> A10 -> A12", () => {
    expect(intake(R(), "OUT006", "ambient", 601.7, 3.428, "2025-12-23", "2025-12-22", "14:20")).toEqual({
      status: "CONFIRMED", runDate: "2025-12-23", reason: "ON_TIME" });
  });
  it("TC-02 after cutoff: A10 -> A11", () => {
    expect(intake(R(), "OUT006", "ambient", 601.7, 3.428, "2025-12-23", "2025-12-22", "16:05")).toEqual({
      status: "CONFIRMED", runDate: "2025-12-24", reason: "AFTER_CUTOFF" });
  });
  it("TC-03 non-operating day: A6 -> A7", () => {
    expect(intake(R(), "OUT006", "ambient", 601.7, 3.428, "2026-04-13", "2026-04-10", "10:00")).toEqual({
      status: "CONFIRMED", runDate: "2026-04-15", reason: "NON_OPERATING_DAY" });
  });
  it("TC-04 Monday's cutoff is Saturday 16:00: A9 -> A10 -> A11", () => {
    expect(intake(R(), "OUT006", "ambient", 601.7, 3.428, "2025-12-22", "2025-12-20", "17:00")).toEqual({
      status: "CONFIRMED", runDate: "2025-12-23", reason: "AFTER_CUTOFF" });
  });
  it("TC-05 Style cannot be chilled: A1 -> A2", () => {
    expect(intake(R(), "OUT015", "chilled", 300, 3, "2025-12-23", "2025-12-22", "10:00")).toEqual({
      status: "REJECT", runDate: null, reason: "ONLY_FRESH_CAN_BE_CHILLED" });
  });
  it("TC-06 bigger than every truck: A4 -> A5", () => {
    expect(intake(R(), "OUT070", "ambient", 2561.6, 40.66, "2025-12-23", "2025-12-22", "10:00").reason).toBe(
      "SPLIT_ORDER_EXCEEDS_LARGEST_VEHICLE");
  });
  it("TC-07 van_only chilled bigger than the reefer van: A3 -> A5", () => {
    expect(intake(R(), "OUT001", "chilled", 1100, 5, "2025-12-23", "2025-12-22", "10:00").reason).toBe(
      "SPLIT_ORDER_EXCEEDS_LARGEST_VEHICLE");
  });

  // ------------------------------------------------------------------ F2 eligibility
  it("TC-08 vehicle type: B3, B4, BOK", () => {
    expect(checkVehicle(R(), S.byRef["S1-001"]!, "VEH037", S.status)).toBe("NEEDS_REEFER");
    expect(checkVehicle(R(), S.byRef["S1-001"]!, "VEH003", S.status)).toBe("NEEDS_VAN");
    expect(checkVehicle(R(), S.byRef["S1-001"]!, "VEH036", S.status)).toBeNull();
  });
  it("TC-09 wrong depot: B2", () => {
    expect(checkVehicle(R(), S.byRef["S1-001"]!, "VEH057", { ...S.status, VEH057: "available" })).toBe("WRONG_DEPOT");
  });
  it("TC-10 in workshop: B1", () => {
    expect(checkVehicle(R(), S.byRef["S1-001"]!, "VEH035", S.status)).toBe("IN_WORKSHOP");
  });
  it("TC-11 over weight: B5", () => {
    const tech = makeOrder(R(), routes().extras.techOrder);
    expect(tech.kg).toBe(1771.0);
    expect(checkVehicle(R(), tech, "VEH038", { VEH038: "available" })).toBe("OVER_WEIGHT");
  });
  it("TC-12 over volume: B6", () => {
    expect(checkVehicle(R(), S.byRef["S1-061"]!, "VEH038", S.status)).toBe("OVER_VOLUME");
  });
  it("TC-13 worst single stop fits the budget: B7 cannot fire", () => {
    expect(tripMinutes(R(), "Fresh", "Badulla", ["rear_dock"])).toBe(201);
  });
  it("TC-14 unavoidable reasons: R1-R4", () => {
    expect(unavoidableReason(R(), S.byRef["S1-078"]!, S.status)).toBe("EXCEEDS_EVERY_VEHICLE");
    expect(unavoidableReason(R(), S.byRef["S1-001"]!, { ...S.status, VEH036: "in_workshop" })).toBe("NO_REEFER_VAN_AVAILABLE");
    const noReefers = { ...S.status, VEH003: "in_workshop", VEH006: "in_workshop", VEH007: "in_workshop", VEH036: "in_workshop" };
    expect(unavoidableReason(R(), S.byRef["S1-012"]!, noReefers)).toBe("NO_REEFER_AVAILABLE");
  });

  // ------------------------------------------------------------------ F3 weight
  it("TC-15 weights: C1", () => {
    expect(r3(weight(S.byRef["S1-083"]!))).toBe(1118.659);
    expect(r3(weight(S.byRef["S1-001"]!))).toBe(52.445);
    expect(r3(weight(S.byRef["S1-000"]!))).toBe(20.5);
  });

  // ------------------------------------------------------------------ F5 rules 1-7 (2B mode)
  it("TC-16 booklet budget example: 101 + 112 = 213 <= 270, then a third trip", () => {
    const gampaha = [o("G1", "OUT025"), o("G2", "OUT026"), o("G3", "OUT027")];
    const colombo = [o("C1", "OUT004"), o("C2", "OUT006"), o("C3", "OUT007"), o("C4", "OUT014")];
    expect(tripMinutes(R(), "Fresh", "Gampaha", gampaha.map((x) => x.outlet.dock))).toBe(101);
    expect(tripMinutes(R(), "Fresh", "Colombo", colombo.map((x) => x.outlet.dock))).toBe(112);
    expect(checkVehicleDay(R(), "VEH014", [gampaha, colombo], emptyContext(), MODE_2B).ok).toBe(true);
    const third = [o("C5", "OUT012", "ambient", 10, 100, 0.5)];
    expect(checkVehicleDay(R(), "VEH014", [gampaha, colombo, third], emptyContext(), MODE_2B).code).toBe("R7_TRIP_LIMIT");
  });
  it("TC-17 Fresh budget: E9", () => {
    expect(tripMinutes(R(), "Fresh", "Puttalam", ["rear_dock", "rear_dock", "rear_dock"])).toBe(266);
    const puttalam = [o("P1", "OUT073", "ambient", 30, 300, 1.5), o("P1c", "OUT073", "chilled", 30, 300, 1.5),
      o("P2", "OUT074", "chilled", 30, 300, 1.5), o("P3", "OUT075", "chilled", 30, 300, 1.5)];
    expect(checkVehicleDay(R(), "VEH003", [puttalam], emptyContext(), MODE_2B).code).toBe("R7_FRESH_BUDGET_270");
    const badulla = [o("B1", "OUT110", "ambient", 40, 300, 1.5), o("B2", "OUT111", "ambient", 40, 300, 1.5),
      o("B3", "OUT112", "ambient", 40, 300, 1.5)];
    expect(checkVehicleDay(R(), "VEH046", [badulla], emptyContext(), MODE_2B).code).toBe("R7_FRESH_BUDGET_270");
  });
  it("TC-18 weight and volume: E5, E6", () => {
    const tech = [S.byRef["S1-023"]!, S.byRef["S1-024"]!, S.byRef["S1-025"]!];
    expect(checkVehicleDay(R(), "VEH008", [tech], emptyContext(), MODE_2B).code).toBe("R6_WEIGHT");
    expect(checkVehicleDay(R(), "VEH009", [tech], emptyContext(), MODE_2B).ok).toBe(true);
    const style = [S.byRef["S1-060"]!, S.byRef["S1-061"]!];
    expect(checkVehicleDay(R(), "VEH015", [style], emptyContext(), MODE_2B).ok).toBe(true);
    expect(checkVehicleDay(R(), "VEH037", [style], emptyContext(), MODE_2B).code).toBe("R6_WEIGHT");
    const pair = [o("SV1", "OUT057", "ambient", 20, 280, 4.5), o("SV2", "OUT057", "ambient", 20, 280, 4.5)];
    expect(checkVehicleDay(R(), "VEH037", [pair], emptyContext(), MODE_2B).code).toBe("R6_VOLUME");
  });
  it("TC-19 brand and district: E3", () => {
    expect(checkVehicleDay(R(), "VEH009", [[S.byRef["S1-000"]!, S.byRef["S1-024"]!]], emptyContext(), MODE_2B).code).toBe(
      "R1_BRAND_DISTRICT");
  });

  // ------------------------------------------------------------------ F6 route-leg scheduling
  it("TC-20 planned legs of R023442 and own stop order", () => {
    const stops = route("R023442");
    const { legs, back } = schedule(R(), stops, m("03:28"), dec23(), PLANNED, true);
    expect(legs.map((l) => hm(l.arrive))).toEqual(["05:19", "05:54", "06:29", "07:04", "07:39"]);
    expect(hm(back)).toBe("09:45");
    expect(tripMinutes(R(), "Fresh", "Nuwara Eliya", stops.map((x) => x.outlet.dock))).toBe(266);
    expect(sequence(stops).map((x) => x.outletId)).toEqual(["OUT105", "OUT108", "OUT104", "OUT107", "OUT106"]);
  });
  it("TC-21 early arrival waits: G15 -> G16", () => {
    const { legs } = schedule(R(), [o("W1", "OUT001", "ambient", 12, 100, 0.5)], m("04:00"), emptyContext(), PLANNED);
    const leg = legs[0]!;
    expect([hm(leg.arrive), Math.round(leg.wait), hm(leg.start), hm(leg.leave)]).toEqual(["04:24", 36, "05:00", "05:16"]);
  });
  it("TC-22 mall order fixed: G1 + F7", () => {
    const rec = routes().routes["R000144"]!;
    expect(rec.legs.map((l) => l.to_outlet)).toEqual(["OUT018", "OUT016"]);
    expect(rec.legs[1]!.planned_arrival_time).toBe("11:28");
    const stops = sequence(orders(rec.orders));
    const t0 = departureTime(R(), stops, m("07:30"), rec.ctx);
    const { legs } = schedule(R(), stops, t0, rec.ctx, PLANNED);
    expect(stops.map((x) => x.outletId)).toEqual(["OUT016", "OUT018"]);
    expect(hm(t0)).toBe("08:36");
    expect(legs.map((l) => hm(l.arrive))).toEqual(["09:00", "10:07"]);
    expect(Math.round(legs[1]!.wait)).toBe(23);
    expect(legs.some((l) => l.late)).toBe(false);
  });
  it("TC-23 expected legs predict real lateness the evening before", () => {
    const { legs } = schedule(R(), route("R023442"), m("03:28"), dec23(), EXPECTED, true);
    expect(legs.map((l) => hm(l.arrive))).toEqual(["05:42", "06:32", "07:27", "08:27", "09:24"]);
    expect(legs.map((l) => l.late)).toEqual([false, false, false, true, true]);
    expect(routes().routes["R023442"]!.legs.map((l) => l.arrival_time > "08:00")).toEqual([false, false, false, true, true]);
  });

  // ------------------------------------------------------------------ F7 departure, trip 2, fuel
  it("TC-24 departure rule: H1-H2", () => {
    expect(hm(departureTime(R(), [S.byRef["S1-007"]!], m("02:00"), S.ctx))).toBe("05:06");
  });
  it("TC-25 second trip clock: budget allows Puttalam + Colombo, the clock does not", () => {
    const trips = [[S.byRef["S1-083"]!], [S.byRef["S1-007"]!]];
    expect(tripMinutes(R(), "Fresh", "Puttalam", ["rear_dock"]) + tripMinutes(R(), "Fresh", "Colombo", ["street"])).toBe(228);
    expect(checkVehicleDay(R(), "VEH003", trips, S.ctx, MODE_2B).ok).toBe(true);
    expect(checkVehicleDay(R(), "VEH003", trips, S.ctx, MODE_LIVE).code).toBe("TRIP2_WINDOW_LATE");
  });
  it("TC-26 second trip feasible: Colombo then Gampaha", () => {
    const chk = checkVehicleDay(R(), "VEH003", [[S.byRef["S1-007"]!], [S.byRef["S1-038"]!]], S.ctx, MODE_LIVE);
    expect(chk.ok).toBe(true);
    expect(chk.timed!.map(([s, t0]) => [s[0]!.outletId, hm(t0!)])).toEqual([["OUT004", "05:06"], ["OUT032", "06:40"]]);
  });
  it("TC-27 fuel quota: E12", () => {
    const badulla = [o("B1", "OUT110", "ambient", 40, 300, 1.5), o("B2", "OUT111", "ambient", 40, 300, 1.5)];
    const kandy = [o("K1", "OUT084", "ambient", 40, 300, 1.5), o("K2", "OUT085", "ambient", 40, 300, 1.5),
      o("K3", "OUT086", "ambient", 40, 300, 1.5)];
    expect(r1(litres(R(), badulla, "VEH046"))).toBe(38.9);
    expect(checkVehicleDay(R(), "VEH046", [badulla], dec23(), MODE_LIVE, 330).code).toBe("FUEL_QUOTA");
    expect(r1(litres(R(), kandy, "VEH046"))).toBe(3.1);
    expect(checkVehicleDay(R(), "VEH046", [kandy], dec23(), MODE_LIVE, 330).ok).toBe(true);
  });

  // ------------------------------------------------------------------ F4 + F8 on the S1 peak day
  it("TC-28 S1 totals, and the organisers' check_allocation.py passes", () => {
    const chilled = S.list.filter((x) => x.temp === "chilled").map((x) => x.ref);
    for (const [mode, served, chilledServed] of [["2B", 77, 19], ["LIVE", 74, 16]] as const) {
      const sm = servedMap(plans[mode]);
      expect(sm.size).toBe(served);
      expect(chilled.filter((r) => sm.has(r)).length).toBe(chilledServed);
    }
    expect([...plans["2B"].trips.values()].reduce((n, t) => n + t.length, 0)).toBe(28);

    const python = process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3");
    const checker = resolve(GOLDEN_DIR, "../check_allocation.py");
    const probe = spawnSync(python, ["--version"]);
    if (probe.status !== 0) return; // no python on this machine: parity with the checker runs in CI
    const sm = servedMap(plans["2B"]);
    const rows = S.list.map((x) => {
      const s = sm.get(x.ref);
      return ["S1", x.ref, x.outletId, s ? "served" : "deferred", s ? s[0] : "", s ? s[1] : ""].join(",");
    });
    const dir = mkdtempSync(join(tmpdir(), "wp-2b-"));
    const file = join(dir, "submission_task2b.csv");
    writeFileSync(file, ["scenario,order_ref,outlet_id,decision,vehicle_id,trip_id", ...rows].join("\n") + "\n");
    const out = spawnSync(python, [checker, file], { encoding: "utf8" });
    expect(out.stdout + out.stderr).toContain("FEASIBILITY: PASSED");
  });
  it("TC-29 S1 deferral classes: J7-J9", () => {
    const d2b = Object.fromEntries([...plans["2B"].deferrals].map(([r, d]) => [r, [d.kind, d.reason]]));
    expect(d2b["S1-078"]).toEqual(["UNAVOIDABLE", "EXCEEDS_EVERY_VEHICLE"]);
    delete d2b["S1-078"];
    expect(d2b).toEqual(Object.fromEntries(
      ["S1-056", "S1-058", "S1-064", "S1-067", "S1-071", "S1-073", "S1-075"].map((r) => [r, ["CAPACITY_FORCED", "R7_TRIP_LIMIT"]])));
    const live = plans.LIVE.deferrals;
    expect([live.get("S1-033")!.kind, live.get("S1-033")!.reason]).toEqual(["CHOSEN", "lost to S1-041"]);
    for (const r of ["S1-046", "S1-051"]) expect([live.get(r)!.kind, live.get(r)!.reason]).toEqual(["CAPACITY_FORCED", "R7_TRIP_LIMIT"]);
    expect(live.size).toBe(11);
  });
  it("TC-30 repeat deferral is served: S1-083 skipped yesterday", () => {
    for (const p of Object.values(plans)) expect(servedMap(p).has("S1-083")).toBe(true);
  });
  it("TC-31 van-only chilled on the only reefer van runs twice", () => {
    const trio = [S.byRef["S1-001"]!, S.byRef["S1-003"]!, S.byRef["S1-005"]!];
    expect(r1(trio.reduce((s, x) => s + x.kg, 0))).toBe(1095.7);
    for (const p of Object.values(plans)) {
      const sm = servedMap(p);
      expect(trio.map((x) => sm.get(x.ref))).toEqual([["VEH036", 1], ["VEH036", 2], ["VEH036", 1]]);
    }
    const chk = checkVehicleDay(R(), "VEH036", [[trio[0]!, trio[2]!], [trio[1]!]], S.ctx, MODE_LIVE);
    expect(chk.timed!.map(([, t0]) => hm(t0!))).toEqual(["04:36", "06:34"]);
    const first = schedule(R(), chk.timed![0]![0], chk.timed![0]![1]!, S.ctx, PLANNED, true);
    const second = schedule(R(), chk.timed![1]![0], chk.timed![1]![1]!, S.ctx, PLANNED, true);
    expect(first.legs.map((l) => hm(l.arrive))).toEqual(["05:00", "05:24"]);
    expect(hm(first.back)).toBe("06:04");
    expect(second.legs.map((l) => hm(l.arrive))).toEqual(["06:58"]);
  });

  // ------------------------------------------------------------------ F9 live operations
  it("TC-32 late departure is rescheduled: K10, K6 -> K8", () => {
    expect(notDeparted(m("04:26"), m("04:40"), false)).toBe(false);
    expect(notDeparted(m("04:26"), m("04:41"), false)).toBe(true);
    const etas = rescheduleRemaining(R(), route("R023443"), [], m("05:09"), dec23());
    expect(etas.map((e) => [e.outletId, hm(e.eta), e.late])).toEqual([
      ["OUT052", "07:42", true], ["OUT055", "08:27", true], ["OUT050", "09:10", true], ["OUT051", "09:54", true]]);
  });
  it("TC-33 long-stop clock starts at window open: K11", () => {
    const stop = route("R023464").find((x) => x.outletId === "OUT027")!;
    expect(r1(serviceMinutes(R(), stop, dec23(), EXPECTED))).toBe(31.4);
    expect(hm(longStopAlarmTime(R(), stop, m("04:42"), dec23()))).toBe("05:41");
  });
  it("TC-34 dead-zone projection and reconnect: K12", () => {
    const stops = route("R023442");
    const { where, etas } = projectPosition(R(), stops, [[m("05:38"), m("05:52")]], m("07:45"), dec23());
    expect(where).toBe("driving to OUT106");
    expect(etas.map((e) => [e.outletId, hm(e.eta)])).toEqual([["OUT108", "06:18"], ["OUT104", "07:12"], ["OUT106", "08:12"], ["OUT107", "09:09"]]);
    const done = [[m("05:38"), m("05:52")], [m("06:10"), m("06:28")], [m("06:46"), m("07:29")], [m("08:19"), m("08:44")]] as const;
    expect(hm(rescheduleRemaining(R(), stops, done, m("08:58"), dec23())[0]!.eta)).toBe("09:19");
  });
  it("TC-35 offline sync: Q1-Q6", () => {
    const applied = new Set<string>();
    const versions = { OUT107: 2 };
    expect(syncEvent(applied, versions, { uuid: "e1", stop: "OUT108", baseVersion: 1 })).toBe("APPLY_FACT_KEEP_RECORDED_TIME");
    expect(syncEvent(applied, versions, { uuid: "e1", stop: "OUT108", baseVersion: 1 })).toBe("IGNORE_DUPLICATE");
    expect(syncEvent(applied, versions, { uuid: "e5", stop: "OUT107", baseVersion: 1 })).toBe(
      "APPLY_FACT_KEEP_RECORDED_TIME + RAISE_CONFLICT");
  });

  // ------------------------------------------------------------------ M16-M23 publish, dock, end of day
  it("TC-36 load list is last stop first: M16", () => {
    const trip = plans.LIVE.timed.find((t) => t.vehicleId === "VEH036" && t.number === 1)!;
    expect(trip.stops.map((x) => x.outletId)).toEqual(["OUT001", "OUT003"]);
    expect(loadList(trip)).toEqual(["S1-005", "S1-001"]);
  });
  it("TC-37 dock sign-off lock: M19-M21", () => {
    expect(dockSignoff(0, null)).toBe("RELEASED");
    expect(dockSignoff(1, null)).toBe("LOCKED");
    expect(dockSignoff(1, "HOLD")).toBe("RELEASED_HOLD");
  });
  it("TC-38 carry-over: deferred orders return with deferredYesterday = 1", () => {
    const next = Object.fromEntries(carryOver(plans["2B"], S.list).map((x) => [x.ref, x]));
    expect(next["S1-078"]).toBeUndefined();
    expect(next["S1-058"]!.deferredYesterday).toBe(1);
    expect(next["S1-058"]!.daysSinceLastServed).toBe(S.byRef["S1-058"]!.daysSinceLastServed + 1);
    expect(weight(next["S1-058"]!)).toBeGreaterThan(1000);
  });

  // ------------------------------------------------------------------ SC-5 worst day
  it("SC-5 the worst day in history is flagged the evening before: 64 of 70 late stops", () => {
    const w = routes().worstDay;
    let lateTotal = 0, caught = 0, falseAlarms = 0;
    for (const r of w.routes) {
      const { legs } = schedule(R(), orders(r.orders), m(r.departure), w.ctx, EXPECTED, true);
      legs.forEach((leg, k) => {
        const late = m(r.actualArrivals[k]!) > leg.close;
        const flagged = leg.late || leg.risk;
        lateTotal += late ? 1 : 0;
        caught += late && flagged ? 1 : 0;
        falseAlarms += flagged && !late ? 1 : 0;
      });
    }
    expect([lateTotal, caught, falseAlarms]).toEqual([70, 64, 7]);
  });
});
