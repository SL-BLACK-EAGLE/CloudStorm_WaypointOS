"""The algorithm checked against the dataset as it is (flowchart section 14.1)."""
import numpy as np
import pytest

import datasets as ds
from algorithm import EXPECTED, MODE_2B, MODE_LIVE, DayContext, Order, check_vehicle_day, schedule, sequence
from reference import ALLOWANCE, DISTRICTS, OUTLETS, hhmm_to_min as m


@pytest.fixture(scope="module")
def legs():
    lg = ds.legs().sort_values(["route_id", "seq"]).copy()
    lg["dock"] = lg.to_outlet.map(lambda x: OUTLETS[x].dock)
    return lg


def test_v1_planned_leg_minutes(legs):
    """P07: planned travel = round(km / district free-flow km/h x 60) on every leg"""
    kmh = legs.district.map(lambda d: DISTRICTS[d].free_flow_kmh)
    assert (np.floor(legs.distance_km / kmh * 60 + 0.5) == legs.planned_travel_duration_min).all()


def test_v2_planned_dwell_is_the_allowance(legs):
    """P08: planned departure - previous planned arrival = allowance of the previous stop (no wait added)"""
    prev_arr = legs.groupby("route_id").planned_arrival_time.shift()
    prev_dock = legs.groupby("route_id").dock.shift()
    x = legs[prev_arr.notna()]
    gap = x.planned_depart_time.map(m) - prev_arr[prev_arr.notna()].map(m)
    allow = [ALLOWANCE[(b, d)] for b, d in zip(x.brand, prev_dock[prev_arr.notna()])]
    assert (gap.values == np.array(allow)).all()


def test_v3_stop_order_is_window_close(legs):
    """P09: 98.5% of routes visit stops by window close; every exception is a Style/Tech mall route"""
    close = legs.to_outlet.map(lambda x: OUTLETS[x].close)
    bad = legs.assign(close=close).groupby("route_id").close.apply(lambda s: (s.diff().dropna() < 0).any())
    assert round(1 - bad.mean(), 3) == 0.985
    bad_routes = legs[legs.route_id.isin(bad[bad].index)]
    assert set(bad_routes.brand) <= {"Style", "Tech"}
    assert bad_routes.groupby("route_id").to_outlet.apply(lambda s: any(OUTLETS[x].parking == "mall_dock" for x in s)).all()


def test_v4_history_obeys_rules_1_to_7():
    """F5 in 2B mode accepts every recorded vehicle-day (25,198 routes)"""
    d = ds.deliveries().dropna(subset=["route_id"]).sort_values(["route_id", "seq_in_route"])
    for (vid, day), g in d.groupby(["vehicle_id", "dispatch_date"]):
        trips = [[Order(r.delivery_id, r.outlet_id, r.temp_requirement, int(r.order_units), float(r.order_weight_kg), float(r.order_volume_m3))
                  for r in t.itertuples()] for _, t in g.groupby("route_id")]
        assert check_vehicle_day(vid, trips, DayContext(), MODE_2B).ok, (vid, day)


def test_v7_expected_mode_on_2026_holdout():
    """F6 EXPECTED replay of every 2026 route: arrival MAE and late-risk recall vs the dataset's own plan"""
    lg, d = ds.legs(), ds.deliveries().dropna(subset=["route_id"]).set_index(["route_id", "seq_in_route"])
    hold = lg[lg.date >= "2026-01-01"]
    err, late, flag, plan_flag = [], [], [], []
    for rid, g in hold.groupby("route_id"):
        g = g.sort_values("seq")
        stops = [Order(d.loc[(rid, s.seq)].delivery_id, s.to_outlet, d.loc[(rid, s.seq)].temp_requirement, int(d.loc[(rid, s.seq)].order_units), 0, 0)
                 for s in g.itertuples()]
        legs, _ = schedule(stops, m(g.planned_depart_time.iloc[0]), DayContext.for_date(g.date.iloc[0]), EXPECTED, keep_order=True)
        for leg, s in zip(legs, g.itertuples()):
            err.append(abs(leg.arrive - m(s.arrival_time)))
            late.append(m(s.arrival_time) > leg.close)
            flag.append(leg.late or leg.risk)
            plan_flag.append(m(s.planned_arrival_time) > leg.close)
    late, flag, plan_flag = map(np.array, (late, flag, plan_flag))
    assert round(np.mean(err), 1) == 19.3
    assert round((late & flag).sum() / late.sum(), 2) == 0.85
    assert round((late & plan_flag).sum() / late.sum(), 2) == 0.04


def test_v8_clock_rule_rejects_most_historical_double_fresh_days():
    """F5 LIVE: trip 2 cannot start before trip 1 is back; history ignored this"""
    d = ds.deliveries().dropna(subset=["route_id"])
    fresh = d[d.brand == "Fresh"]
    days = fresh.groupby(["vehicle_id", "dispatch_date"]).route_id.nunique()
    sample = days[days == 2].sample(300, random_state=1).index
    fails = 0
    for vid, day in sample:
        g = fresh[(fresh.vehicle_id == vid) & (fresh.dispatch_date == day)].sort_values(["route_id", "seq_in_route"])
        trips = [[Order(r.delivery_id, r.outlet_id, r.temp_requirement, int(r.order_units), float(r.order_weight_kg), float(r.order_volume_m3))
                  for r in t.itertuples()] for _, t in g.groupby("route_id")]
        assert check_vehicle_day(vid, trips, DayContext(), MODE_2B).ok
        fails += not check_vehicle_day(vid, trips, DayContext.for_date(day), MODE_LIVE).ok
    assert fails / len(sample) > 0.75
