"""Full-day simulations SC-1..SC-5 on real dates (flowchart section 14.2). All vehicles available unless stated."""
import pytest

import datasets as ds
from algorithm import EXPECTED, MODE_LIVE, DayContext, check_vehicle_day, plan_day, schedule
from reference import OUTLETS, VEHICLES, hhmm_to_min as m


def run(day, depot, workshop=()):
    orders = ds.day_orders(day, depot)
    ctx, fuel = DayContext.for_date(day), ds.weekly_fuel_used(day, depot)
    plan = plan_day(orders, ds.depot_status(depot, workshop), ctx, MODE_LIVE, fuel)
    for v, trips in plan.trips.items():            # independent re-check: every published vehicle-day passes F5
        assert check_vehicle_day(v, trips, ctx, MODE_LIVE, fuel.get(v, 0.0)).ok, v
    return orders, plan


def flagged(plan):
    return sum(leg.late or leg.risk for t in plan.timed for leg in t.expected)


@pytest.mark.parametrize("depot, n, trips, vehicles, flags", [("Peliyagoda", 81, 22, 18, 14), ("Kandy", 57, 17, 15, 7)])
def test_sc1_normal_day_serves_every_order(depot, n, trips, vehicles, flags):
    """SC-1: 10 Sep 2025, no festival, payday or monsoon"""
    orders, plan = run("2025-09-10", depot)
    assert len(orders) == n and len(plan.served) == n and not plan.deferrals
    assert (len(plan.timed), len(plan.trips), flagged(plan)) == (trips, vehicles, flags)
    assert ds.history_summary("2025-09-10", depot)["deferred"] == 0


def test_sc2_festival_peak_beats_history():
    """SC-2: 23 Dec 2025 Peliyagoda, festival ramp 0.8; history deferred 11 chilled orders"""
    orders, plan = run("2025-12-23", "Peliyagoda")
    assert ds.history_summary("2025-12-23", "Peliyagoda")["deferred"] == 11
    assert len(orders) == 90 and len(plan.served) == 89
    (ref, d), = plan.deferrals.items()
    assert (ref, d.kind, d.lost_to) == ("ORD0085948", "CHOSEN", "ORD0085940")
    assert flagged(plan) == 24


def test_sc2b_reefer_van_in_workshop():
    """SC-2b: same day with VEH036 in the workshop"""
    _, plan = run("2025-12-23", "Peliyagoda", ("VEH036",))
    assert len(plan.served) == 87
    assert {r: (d.kind, d.reason) for r, d in plan.deferrals.items()} == {
        "ORD0085948": ("CHOSEN", "lost to ORD0085940"),
        "ORD0085950": ("CAPACITY_FORCED", "R7_FRESH_BUDGET_270"),
        "ORD0085953": ("CAPACITY_FORCED", "R7_FRESH_BUDGET_270")}


def test_sc3_van_only_pressure_in_kandy():
    """SC-3: 23 Dec 2025 Kandy, 13 van-only orders and 4 vans"""
    orders, plan = run("2025-12-23", "Kandy")
    van_only = [o for o in orders if o.parking == "van_only"]
    assert len(van_only) == 13 and len(plan.served) == len(orders) == 51
    assert all(VEHICLES[plan.served[o.ref][0]].type == "van" for o in van_only)
    assert (len(plan.timed), len(plan.trips), flagged(plan)) == (14, 12, 12)


def test_sc5_worst_day_is_flagged_the_evening_before():
    """SC-5: 15 Mar 2025 (monsoon, floods) has the most late stops in history"""
    lg = ds.legs()
    late_by_day = lg.assign(late=[m(a) > OUTLETS[o].close for a, o in zip(lg.arrival_time, lg.to_outlet)]).groupby("date").late.sum()
    day = late_by_day.idxmax()
    assert day == "2025-03-15"
    ctx, caught, false_alarms, late_total = DayContext.for_date(day), 0, 0, 0
    for rid, g in lg[lg.date == day].groupby("route_id"):
        g = g.sort_values("seq")
        legs, _ = schedule(ds.route_orders(rid), m(g.planned_depart_time.iloc[0]), ctx, EXPECTED, keep_order=True)
        for leg, arrival in zip(legs, g.arrival_time):
            late = m(arrival) > leg.close
            late_total += late
            caught += late and (leg.late or leg.risk)
            false_alarms += (leg.late or leg.risk) and not late
    assert (late_total, caught, false_alarms) == (70, 64, 7)
