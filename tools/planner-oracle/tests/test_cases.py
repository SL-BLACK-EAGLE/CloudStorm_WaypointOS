"""Flowchart test cases TC-01..TC-38 (docs/Delivery_Planning_Flowchart.md, section 14.3), built from real dataset rows.

Each test names the chart nodes it walks through, so a failure points at a box in the flowchart.
"""
import pytest

import datasets as ds
from algorithm import (EXPECTED, MODE_2B, MODE_LIVE, PLANNED, DayContext, Order, carry_over, check_vehicle,
                       check_vehicle_day, departure_time, dock_signoff, intake, litres, load_list, long_stop_alarm_time,
                       not_departed, plan_day, project_position, reschedule_remaining, schedule, sequence, service_minutes,
                       sync_event, trip_minutes, unavoidable_reason, weight)
from reference import hhmm_to_min as m, min_to_hhmm as hm

S1_CTX = ds.S1_CONTEXT


def o(ref, outlet, temp="ambient", units=30, kg=200.0, m3=1.0):
    return Order(ref, outlet, temp, units, kg, m3)


# ------------------------------------------------------------------ F1 intake and cutoff
def test_tc01_on_time_order():
    """F1 A1 -> A4 -> A6 -> A8 -> A10 -> A12"""
    assert intake("OUT006", "ambient", 601.7, 3.428, "2025-12-23", "2025-12-22", "14:20") == ("CONFIRMED", "2025-12-23", "ON_TIME")


def test_tc02_after_cutoff():
    """F1 A10 -> A11"""
    assert intake("OUT006", "ambient", 601.7, 3.428, "2025-12-23", "2025-12-22", "16:05") == ("CONFIRMED", "2025-12-24", "AFTER_CUTOFF")


def test_tc03_non_operating_day():
    """F1 A6 -> A7: 13 Apr 2026 New Year and 14 Apr are closed; cutoff Sat 11 Apr 16:00"""
    assert intake("OUT006", "ambient", 601.7, 3.428, "2026-04-13", "2026-04-10", "10:00") == ("CONFIRMED", "2026-04-15", "NON_OPERATING_DAY")


def test_tc04_cutoff_before_sunday():
    """F1 A9 -> A10 -> A11: Monday's cutoff is Saturday 16:00"""
    assert intake("OUT006", "ambient", 601.7, 3.428, "2025-12-22", "2025-12-20", "17:00") == ("CONFIRMED", "2025-12-23", "AFTER_CUTOFF")


def test_tc05_style_cannot_be_chilled():
    """F1 A1 -> A2"""
    assert intake("OUT015", "chilled", 300, 3, "2025-12-23", "2025-12-22", "10:00") == ("REJECT", None, "ONLY_FRESH_CAN_BE_CHILLED")


def test_tc06_bigger_than_every_truck():
    """F1 A4 -> A5: S1-078, 40.66 m3 vs largest truck 38 m3"""
    assert intake("OUT070", "ambient", 2561.6, 40.66, "2025-12-23", "2025-12-22", "10:00") == ("REJECT", None, "SPLIT_ORDER_EXCEEDS_LARGEST_VEHICLE")


def test_tc07_bigger_than_reefer_van():
    """F1 A3 -> A5: van_only chilled 1,100 kg vs reefer van 1,040 kg"""
    assert intake("OUT001", "chilled", 1100, 5, "2025-12-23", "2025-12-22", "10:00") == ("REJECT", None, "SPLIT_ORDER_EXCEEDS_LARGEST_VEHICLE")


# ------------------------------------------------------------------ F2 eligibility
def test_tc08_vehicle_type(s1, s1_status):
    """F2 B3, B4, BOK"""
    assert check_vehicle(s1["S1-001"], "VEH037", s1_status) == "NEEDS_REEFER"
    assert check_vehicle(s1["S1-001"], "VEH003", s1_status) == "NEEDS_VAN"
    assert check_vehicle(s1["S1-001"], "VEH036", s1_status) is None


def test_tc09_wrong_depot(s1, s1_status):
    """F2 B2"""
    assert check_vehicle(s1["S1-001"], "VEH057", {**s1_status, "VEH057": "available"}) == "WRONG_DEPOT"


def test_tc10_in_workshop(s1, s1_status):
    """F2 B1"""
    assert check_vehicle(s1["S1-001"], "VEH035", s1_status) == "IN_WORKSHOP"


def test_tc11_over_weight():
    """F2 B5: Tech OUT064 order of 23 Dec 2025 (1,771.0 kg) vs VEH038 van 1,200 kg"""
    d = ds.deliveries()
    r = d[(d.outlet_id == "OUT064") & (d.order_date == "2025-12-23")].iloc[0]
    tech = Order(r.delivery_id, "OUT064", "ambient", int(r.order_units), float(r.order_weight_kg), float(r.order_volume_m3))
    assert tech.kg == 1771.0
    assert check_vehicle(tech, "VEH038", {"VEH038": "available"}) == "OVER_WEIGHT"


def test_tc12_over_volume(s1, s1_status):
    """F2 B6: S1-061 Style 11.822 m3 vs VEH038 9 m3"""
    assert check_vehicle(s1["S1-061"], "VEH038", s1_status) == "OVER_VOLUME"


def test_tc13_worst_single_stop_fits_budget():
    """F2 B7 cannot fire: Badulla rear dock = 186 + 15"""
    assert trip_minutes("Fresh", "Badulla", ["rear_dock"]) == 201


def test_tc14_unavoidable_reasons(s1, s1_status):
    """F2 R1-R4"""
    assert unavoidable_reason(s1["S1-078"], s1_status) == "EXCEEDS_EVERY_VEHICLE"
    assert unavoidable_reason(s1["S1-001"], {**s1_status, "VEH036": "in_workshop"}) == "NO_REEFER_VAN_AVAILABLE"
    no_reefers = {**s1_status, **{v: "in_workshop" for v in ("VEH003", "VEH006", "VEH007", "VEH036")}}
    assert unavoidable_reason(s1["S1-012"], no_reefers) == "NO_REEFER_AVAILABLE"


# ------------------------------------------------------------------ F3 weight
def test_tc15_weights(s1):
    """F3 C1: 1000 x deferred_yesterday + 20 x days + 10 x chilled + m3"""
    assert round(weight(s1["S1-083"]), 3) == 1118.659
    assert round(weight(s1["S1-001"]), 3) == 52.445
    assert round(weight(s1["S1-000"]), 3) == 20.5


# ------------------------------------------------------------------ F5 rules 1-7 (2B mode)
def test_tc16_booklet_budget_example():
    """F5 E7 -> E9, E1: booklet example 101 + 112 = 213 <= 270, then a third trip"""
    gampaha = [o("G1", "OUT025"), o("G2", "OUT026"), o("G3", "OUT027")]
    colombo = [o("C1", "OUT004"), o("C2", "OUT006"), o("C3", "OUT007"), o("C4", "OUT014")]
    assert trip_minutes("Fresh", "Gampaha", [x.dock for x in gampaha]) == 101
    assert trip_minutes("Fresh", "Colombo", [x.dock for x in colombo]) == 112
    assert check_vehicle_day("VEH014", [gampaha, colombo], DayContext(), MODE_2B).ok
    third = [o("C5", "OUT012", units=10, kg=100, m3=0.5)]
    assert check_vehicle_day("VEH014", [gampaha, colombo, third], DayContext(), MODE_2B).code == "R7_TRIP_LIMIT"


def test_tc17_fresh_budget():
    """F5 E9: Puttalam 3 stops = 266; 4 orders = 305; Badulla 3 stops = 277"""
    assert trip_minutes("Fresh", "Puttalam", ["rear_dock"] * 3) == 266
    puttalam = [o("P1", "OUT073", kg=300, m3=1.5), o("P1c", "OUT073", "chilled", kg=300, m3=1.5),
                o("P2", "OUT074", "chilled", kg=300, m3=1.5), o("P3", "OUT075", "chilled", kg=300, m3=1.5)]
    assert check_vehicle_day("VEH003", [puttalam], DayContext(), MODE_2B).code == "R7_FRESH_BUDGET_270"
    badulla = [o("B1", "OUT110", units=40, kg=300, m3=1.5), o("B2", "OUT111", units=40, kg=300, m3=1.5), o("B3", "OUT112", units=40, kg=300, m3=1.5)]
    assert check_vehicle_day("VEH046", [badulla], DayContext(), MODE_2B).code == "R7_FRESH_BUDGET_270"


def test_tc18_weight_and_volume(s1):
    """F5 E5, E6: Tech is weight-bound, Style is volume-bound; weight is checked before volume"""
    tech = [s1["S1-023"], s1["S1-024"], s1["S1-025"]]
    assert check_vehicle_day("VEH008", [tech], DayContext(), MODE_2B).code == "R6_WEIGHT"
    assert check_vehicle_day("VEH009", [tech], DayContext(), MODE_2B).ok
    style = [s1["S1-060"], s1["S1-061"]]
    assert check_vehicle_day("VEH015", [style], DayContext(), MODE_2B).ok
    assert check_vehicle_day("VEH037", [style], DayContext(), MODE_2B).code == "R6_WEIGHT"
    pair = [o("SV1", "OUT057", units=20, kg=280, m3=4.5), o("SV2", "OUT057", units=20, kg=280, m3=4.5)]
    assert check_vehicle_day("VEH037", [pair], DayContext(), MODE_2B).code == "R6_VOLUME"


def test_tc19_brand_and_district(s1):
    """F5 E3"""
    assert check_vehicle_day("VEH009", [[s1["S1-000"], s1["S1-024"]]], DayContext(), MODE_2B).code == "R1_BRAND_DISTRICT"


# ------------------------------------------------------------------ F6 route-leg scheduling
def test_tc20_planned_legs_r023442(dec23):
    """F6 PLANNED from 03:28 in the recorded stop order; F6 G1 own stop order"""
    stops = ds.route_orders("R023442")
    legs, back = schedule(stops, m("03:28"), dec23, PLANNED, keep_order=True)
    assert [hm(l.arrive) for l in legs] == ["05:19", "05:54", "06:29", "07:04", "07:39"]
    assert hm(back) == "09:45"
    assert trip_minutes("Fresh", "Nuwara Eliya", [x.dock for x in stops]) == 266
    assert [x.outlet_id for x in sequence(stops)] == ["OUT105", "OUT108", "OUT104", "OUT107", "OUT106"]


def test_tc21_early_arrival_waits():
    """F6 G15 -> G16"""
    legs, _ = schedule([o("W1", "OUT001", units=12, kg=100, m3=0.5)], m("04:00"), DayContext(), PLANNED)
    leg = legs[0]
    assert (hm(leg.arrive), round(leg.wait), hm(leg.start), hm(leg.leave)) == ("04:24", 36, "05:00", "05:16")


def test_tc22_mall_order_fixed():
    """F6 G1 + F7: the recorded R000144 plan reaches OUT016 after its close; EDF order does not"""
    recorded = ds.route_legs("R000144")
    assert list(recorded.to_outlet) == ["OUT018", "OUT016"] and recorded.planned_arrival_time.iloc[1] == "11:28"
    stops = sequence(ds.route_orders("R000144"))
    ctx = DayContext.for_date(recorded.date.iloc[0])
    t0 = departure_time(stops, m("07:30"), ctx)
    legs, _ = schedule(stops, t0, ctx, PLANNED)
    assert [x.outlet_id for x in stops] == ["OUT016", "OUT018"]
    assert hm(t0) == "08:36"
    assert [hm(l.arrive) for l in legs] == ["09:00", "10:07"] and round(legs[1].wait) == 23
    assert not any(l.late for l in legs)


def test_tc23_expected_legs_predict_real_lateness(dec23):
    """F6 EXPECTED: both real late arrivals of R023442 are predicted the evening before"""
    stops = ds.route_orders("R023442")
    legs, _ = schedule(stops, m("03:28"), dec23, EXPECTED, keep_order=True)
    assert [hm(l.arrive) for l in legs] == ["05:42", "06:32", "07:27", "08:27", "09:24"]
    assert [l.late for l in legs] == [False, False, False, True, True]
    actual = ds.route_legs("R023442")
    assert [a > "08:00" for a in actual.arrival_time] == [False, False, False, True, True]


# ------------------------------------------------------------------ F7 departure, trip 2, fuel
def test_tc24_departure_rule(s1):
    """F7 H1-H2: reach the first stop as it opens"""
    assert hm(departure_time([s1["S1-007"]], m("02:00"), S1_CTX)) == "05:06"


def test_tc25_second_trip_clock(s1):
    """F5 E13-E20: budget allows Puttalam + Colombo (188 + 40), the clock does not"""
    trips = [[s1["S1-083"]], [s1["S1-007"]]]
    assert trip_minutes("Fresh", "Puttalam", ["rear_dock"]) + trip_minutes("Fresh", "Colombo", ["street"]) == 228
    assert check_vehicle_day("VEH003", trips, S1_CTX, MODE_2B).ok
    assert check_vehicle_day("VEH003", trips, S1_CTX, MODE_LIVE).code == "TRIP2_WINDOW_LATE"


def test_tc26_second_trip_feasible(s1):
    """F5 + F7: Colombo then Gampaha fits in clock time"""
    chk = check_vehicle_day("VEH003", [[s1["S1-007"]], [s1["S1-038"]]], S1_CTX, MODE_LIVE)
    assert chk.ok
    assert [(s[0].outlet_id, hm(t0)) for s, t0 in chk.timed] == [("OUT004", "05:06"), ("OUT032", "06:40")]


def test_tc27_fuel_quota(dec23):
    """F5 E12: VEH046 has 20 L of its 350 L left this week"""
    badulla = [o("B1", "OUT110", units=40, kg=300, m3=1.5), o("B2", "OUT111", units=40, kg=300, m3=1.5)]
    kandy = [o("K1", "OUT084", units=40, kg=300, m3=1.5), o("K2", "OUT085", units=40, kg=300, m3=1.5), o("K3", "OUT086", units=40, kg=300, m3=1.5)]
    assert round(litres(badulla, "VEH046"), 1) == 38.9
    assert check_vehicle_day("VEH046", [badulla], dec23, MODE_LIVE, fuel_used_l=330).code == "FUEL_QUOTA"
    assert round(litres(kandy, "VEH046"), 1) == 3.1
    assert check_vehicle_day("VEH046", [kandy], dec23, MODE_LIVE, fuel_used_l=330).ok


# ------------------------------------------------------------------ F4 + F8 on the S1 peak day
@pytest.fixture(scope="module")
def s1_plans(s1, s1_status):
    orders = list(s1.values())
    return {mode: plan_day(orders, s1_status, S1_CTX, mode) for mode in (MODE_2B, MODE_LIVE)}


def test_tc28_s1_totals_and_official_checker(s1, s1_plans, tmp_path):
    """F4 + F8, then the organisers' check_allocation.py"""
    chilled = [r for r, x in s1.items() if x.temp == "chilled"]
    for mode, served, chilled_served in [(MODE_2B, 77, 19), (MODE_LIVE, 74, 16)]:
        plan = s1_plans[mode]
        assert len(plan.served) == served
        assert sum(r in plan.served for r in chilled) == chilled_served
    assert sum(len(t) for t in s1_plans[MODE_2B].trips.values()) == 28
    path = tmp_path / "submission_task2b.csv"
    ds.write_2b_submission(s1_plans[MODE_2B], path)
    passed, output = ds.run_checker(path)
    assert passed, output


def test_tc29_s1_deferral_classes(s1_plans):
    """F8 J7-J9"""
    d2b = {r: (d.kind, d.reason) for r, d in s1_plans[MODE_2B].deferrals.items()}
    assert d2b.pop("S1-078") == ("UNAVOIDABLE", "EXCEEDS_EVERY_VEHICLE")
    assert d2b == {r: ("CAPACITY_FORCED", "R7_TRIP_LIMIT") for r in ["S1-056", "S1-058", "S1-064", "S1-067", "S1-071", "S1-073", "S1-075"]}
    live = {r: (d.kind, d.reason) for r, d in s1_plans[MODE_LIVE].deferrals.items()}
    assert live["S1-033"] == ("CHOSEN", "lost to S1-041")
    assert live["S1-046"] == live["S1-051"] == ("CAPACITY_FORCED", "R7_TRIP_LIMIT")
    assert len(live) == 11


def test_tc30_repeat_deferral_served(s1_plans):
    """F3 + F8: S1-083 was skipped yesterday and has waited 5 days"""
    assert all("S1-083" in p.served for p in s1_plans.values())


def test_tc31_van_only_chilled_on_one_reefer_van(s1, s1_plans):
    """F4 class 0: 1,095.7 kg does not fit VEH036 (1,040 kg) in one trip, so it runs twice"""
    trio = [s1["S1-001"], s1["S1-003"], s1["S1-005"]]
    assert round(sum(x.kg for x in trio), 1) == 1095.7
    for plan in s1_plans.values():
        assert [plan.served[x.ref] for x in trio] == [("VEH036", 1), ("VEH036", 2), ("VEH036", 1)]
    chk = check_vehicle_day("VEH036", [[trio[0], trio[2]], [trio[1]]], S1_CTX, MODE_LIVE)
    assert [hm(t0) for _, t0 in chk.timed] == ["04:36", "06:34"]
    first, back = schedule(chk.timed[0][0], chk.timed[0][1], S1_CTX, PLANNED, keep_order=True)
    second, _ = schedule(chk.timed[1][0], chk.timed[1][1], S1_CTX, PLANNED, keep_order=True)
    assert [hm(l.arrive) for l in first] == ["05:00", "05:24"] and hm(back) == "06:04"
    assert [hm(l.arrive) for l in second] == ["06:58"]


# ------------------------------------------------------------------ F9 live operations
def test_tc32_late_departure_rescheduled(dec23):
    """F9 K10, K6 -> K8: VEH004 planned 04:26, left 05:09"""
    assert not not_departed(m("04:26"), m("04:40"), departed=False)
    assert not_departed(m("04:26"), m("04:41"), departed=False)
    etas = reschedule_remaining(ds.route_orders("R023443"), [], m("05:09"), dec23)
    assert [(e.outlet_id, hm(e.eta), e.late) for e in etas] == [
        ("OUT052", "07:42", True), ("OUT055", "08:27", True), ("OUT050", "09:10", True), ("OUT051", "09:54", True)]
    actual = ds.route_legs("R023443")
    assert list(actual.arrival_time) == ["07:17", "07:57", "08:38", "09:08"]


def test_tc33_long_stop_clock_starts_at_window_open(dec23):
    """F9 K11: arrived 04:42, window opens 05:00"""
    stop = next(x for x in ds.route_orders("R023464") if x.outlet_id == "OUT027")
    assert round(service_minutes(stop, dec23, EXPECTED), 1) == 31.4
    assert hm(long_stop_alarm_time(stop, m("04:42"), dec23)) == "05:41"


def test_tc34_dead_zone_projection_and_reconnect(dec23):
    """F9 K12 then sync: R023442 silent after 05:52"""
    stops = ds.route_orders("R023442")
    where, etas = project_position(stops, [(m("05:38"), m("05:52"))], m("07:45"), dec23)
    assert where == "driving to OUT106"
    assert [(e.outlet_id, hm(e.eta)) for e in etas] == [("OUT108", "06:18"), ("OUT104", "07:12"), ("OUT106", "08:12"), ("OUT107", "09:09")]
    done = [(m("05:38"), m("05:52")), (m("06:10"), m("06:28")), (m("06:46"), m("07:29")), (m("08:19"), m("08:44"))]
    assert hm(reschedule_remaining(stops, done, m("08:58"), dec23)[0].eta) == "09:19"


def test_tc35_offline_sync():
    """F9 Q1-Q6"""
    applied, versions = set(), {"OUT107": 2}
    assert sync_event(applied, versions, {"uuid": "e1", "stop": "OUT108", "base_version": 1}) == "APPLY_FACT_KEEP_RECORDED_TIME"
    assert sync_event(applied, versions, {"uuid": "e1", "stop": "OUT108", "base_version": 1}) == "IGNORE_DUPLICATE"
    assert sync_event(applied, versions, {"uuid": "e5", "stop": "OUT107", "base_version": 1}) == "APPLY_FACT_KEEP_RECORDED_TIME + RAISE_CONFLICT"


# ------------------------------------------------------------------ M16-M23 publish, dock, end of day
def test_tc36_load_list_last_stop_first(s1_plans):
    """M16: the loader sees the stops in reverse driving order"""
    trip = next(t for t in s1_plans[MODE_LIVE].timed if t.vehicle_id == "VEH036" and t.number == 1)
    assert [x.outlet_id for x in trip.stops] == ["OUT001", "OUT003"]
    assert load_list(trip) == ["S1-005", "S1-001"]


def test_tc37_dock_signoff_lock():
    """M19-M21"""
    assert dock_signoff(0, None) == "RELEASED"
    assert dock_signoff(1, None) == "LOCKED"
    assert dock_signoff(1, "HOLD") == "RELEASED_HOLD"


def test_tc38_carry_over(s1, s1_plans):
    """M23: tomorrow deferred orders carry deferred_yesterday = 1; an order bigger than every vehicle is not carried"""
    nxt = {x.ref: x for x in carry_over(s1_plans[MODE_2B], list(s1.values()))}
    assert "S1-078" not in nxt and "S1-058" in nxt
    assert nxt["S1-058"].deferred_yesterday == 1 and nxt["S1-058"].days_since_last_served == s1["S1-058"].days_since_last_served + 1
    assert weight(nxt["S1-058"]) > 1000
