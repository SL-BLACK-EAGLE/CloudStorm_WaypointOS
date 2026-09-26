"""Export golden fixtures for the TypeScript planner (packages/planner).

The Python engine in this folder is the reference implementation of
docs/delivery-planning-flowchart.md. This script serialises its exact inputs and
outputs so the TypeScript port can prove it produces identical plans.

    WAYPOINT_DATA_DIR=../../seed-data/data python export_golden.py

Writes ../../seed-data/golden/*.json. That folder is git-ignored, because the
fixtures are derived from the confidential competition data (booklet p.22).
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import pandas as pd

import datasets as ds
from algorithm import (EXPECTED, MODE_2B, MODE_LIVE, DayContext, departure_time, plan_day, schedule)
from reference import (ALLOWANCE, CALENDAR, DATA_DIR, DISRUPTION, DISTRICTS, OUTLETS, SPEED, VEHICLES,
                       hhmm_to_min)

OUT = Path(os.environ.get("GOLDEN_DIR") or Path(__file__).resolve().parents[2] / "seed-data" / "golden")


def order_json(o):
    return {"ref": o.ref, "outletId": o.outlet_id, "temp": o.temp, "units": o.units, "kg": o.kg, "m3": o.m3,
            "deferredYesterday": o.deferred_yesterday, "daysSinceLastServed": o.days_since_last_served}


def ctx_json(c: DayContext):
    return {"date": c.date, "monsoon": c.monsoon, "festivalRamp": c.festival_ramp, "payday": c.payday,
            "disruption": c.disruption}


def leg_json(l):
    return {"ref": l.ref, "outletId": l.outlet_id, "depart": l.depart, "travel": l.travel, "arrive": l.arrive,
            "wait": l.wait, "start": l.start, "service": l.service, "leave": l.leave, "close": l.close,
            "slack": l.slack, "late": l.late, "risk": l.risk}


def plan_json(p):
    return {
        "mode": p.mode,
        "trips": {v: [[o.ref for o in t] for t in ts] for v, ts in p.trips.items()},
        "deferrals": {r: {"kind": d.kind, "reason": d.reason, "lostTo": d.lost_to} for r, d in p.deferrals.items()},
        "timed": [{
            "vehicleId": t.vehicle_id, "number": t.number, "stops": [o.ref for o in t.stops],
            "departure": t.departure, "tripMinutes": t.trip_minutes, "litres": t.litres,
            "planned": [leg_json(l) for l in t.planned], "backPlanned": t.back_planned,
            "expected": [leg_json(l) for l in t.expected], "backExpected": t.back_expected,
        } for t in p.timed],
    }


def reference_json():
    return {
        "outlets": [{"id": o.id, "brand": o.brand, "district": o.district, "depot": o.depot, "dock": o.dock,
                     "parking": o.parking, "open": o.open, "close": o.close} for o in OUTLETS.values()],
        "vehicles": [{"id": v.id, "type": v.type, "temp": v.temp, "capKg": v.cap_kg, "capM3": v.cap_m3,
                      "kmPerL": v.km_per_l, "weeklyQuotaL": v.weekly_quota_l, "depot": v.depot}
                     for v in VEHICLES.values()],
        "districts": [{"name": d.name, "depot": d.depot, "outboundMin": d.outbound_min, "interStopMin": d.inter_stop_min,
                       "depotKm": d.depot_km, "interStopKm": d.inter_stop_km, "freeFlowKmh": d.free_flow_kmh}
                      for d in DISTRICTS.values()],
        "allowance": [{"brand": b, "dock": k, "minutes": m} for (b, k), m in ALLOWANCE.items()],
        "speed": [{"district": d, "hour": h, "monsoon": mo, "index": s} for (d, h, mo), s in SPEED.items()],
        "calendar": [{"date": day, "isOperating": c["is_operating"], "monsoon": c["monsoon"],
                      "festivalRamp": c["festival_ramp"], "isPayday": c["is_payday"], "isoYear": c["iso_year"],
                      "isoWeek": c["iso_week"]} for day, c in CALENDAR.items()],
    }


def scenario(name, orders, status, ctx, mode, fuel=None):
    fuel = fuel or {}
    plan = plan_day(orders, status, ctx, mode, fuel)
    return {"name": name, "mode": mode, "ctx": ctx_json(ctx), "status": status, "fuelUsed": fuel,
            "orders": [order_json(o) for o in orders], "plan": plan_json(plan)}


def day(dt, depot, workshop=()):
    return (ds.day_orders(dt, depot), ds.depot_status(depot, workshop), DayContext.for_date(dt),
            ds.weekly_fuel_used(dt, depot))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "reference.json").write_text(json.dumps(reference_json()))

    s1o, s1s = ds.s1_orders(), ds.s1_status()
    scenarios = [
        scenario("s1-2b", s1o, s1s, ds.S1_CONTEXT, MODE_2B),
        scenario("s1-live", s1o, s1s, ds.S1_CONTEXT, MODE_LIVE),
    ]
    for dt, depot, ws in [("2025-09-10", "Peliyagoda", ()), ("2025-09-10", "Kandy", ()),
                          ("2025-12-23", "Peliyagoda", ()), ("2025-12-23", "Kandy", ()),
                          ("2025-12-23", "Peliyagoda", ("VEH036",))]:
        o, s, c, f = day(dt, depot, ws)
        name = f"{dt}-{depot.lower()}" + ("-" + "-".join(w.lower() for w in ws) if ws else "")
        scenarios.append(scenario(name, o, s, c, MODE_LIVE, f))
    for sc in scenarios:
        (OUT / f"plan-{sc['name']}.json").write_text(json.dumps(sc))

    # recorded routes used by the F6/F7/F9 test cases, with their day context
    routes = {}
    for rid in ["R023442", "R023443", "R023464", "R000144"]:
        lg = ds.route_legs(rid)
        routes[rid] = {"date": lg.date.iloc[0], "ctx": ctx_json(DayContext.for_date(lg.date.iloc[0])),
                       "orders": [order_json(o) for o in ds.route_orders(rid)],
                       "legs": lg[["to_outlet", "planned_depart_time", "planned_arrival_time", "arrival_time"]].to_dict("records")}
    d = ds.deliveries()
    tech = d[(d.outlet_id == "OUT064") & (d.order_date == "2025-12-23")].iloc[0]
    extras = {"techOrder": {"ref": tech.delivery_id, "outletId": "OUT064", "temp": "ambient", "units": int(tech.order_units),
                            "kg": float(tech.order_weight_kg), "m3": float(tech.order_volume_m3),
                            "deferredYesterday": 0, "daysSinceLastServed": 1}}

    # SC-5: every route of the worst day in history, with expected legs from the oracle
    worst = "2025-03-15"
    ctx = DayContext.for_date(worst)
    lg = ds.legs()
    sc5 = []
    for rid, g in lg[lg.date == worst].groupby("route_id"):
        g = g.sort_values("seq")
        orders = ds.route_orders(rid)
        legs, _ = schedule(orders, hhmm_to_min(g.planned_depart_time.iloc[0]), ctx, EXPECTED, keep_order=True)
        sc5.append({"routeId": rid, "departure": g.planned_depart_time.iloc[0], "orders": [order_json(o) for o in orders],
                    "actualArrivals": list(g.arrival_time), "expected": [leg_json(l) for l in legs]})
    (OUT / "routes.json").write_text(json.dumps({"routes": routes, "extras": extras,
                                                 "worstDay": {"date": worst, "ctx": ctx_json(ctx), "routes": sc5}}))
    print(f"wrote {len(scenarios)} plans, {len(routes)} routes, {len(sc5)} worst-day routes -> {OUT}")


if __name__ == "__main__":
    main()
