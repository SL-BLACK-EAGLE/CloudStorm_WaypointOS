"""Planning inputs built from the dataset: the S1 peak day, any historical day, recorded routes, and Task 2B export."""
import subprocess
import sys
from functools import lru_cache

import pandas as pd

from algorithm import DayContext, Order, Plan, previous_operating_day
from reference import CALENDAR, DATA_DIR, DISTRICTS, OUTLETS, VEHICLES, hhmm_to_min

CHECKER = DATA_DIR.parent / "check_allocation.py"
S1_CONTEXT = DayContext(festival_ramp=0.3)   # S1: festival one week away (calendar ramp 7 days before = 0.3), no payday, no monsoon


@lru_cache(maxsize=None)
def deliveries() -> pd.DataFrame:
    return pd.read_csv(DATA_DIR / "Training Data" / "deliveries_train.csv")


@lru_cache(maxsize=None)
def legs() -> pd.DataFrame:
    return pd.read_csv(DATA_DIR / "Training Data" / "route_legs_train.csv")


@lru_cache(maxsize=None)
def s1_table() -> pd.DataFrame:
    return pd.read_csv(DATA_DIR / "Test Data" / "task2b_peak_day_scenarios.csv")


# ---------------------------------------------------------------- S1 peak day (Task 2B)
def s1_orders() -> list:
    return [Order(r.order_ref, r.outlet_id, r.temp_requirement, int(r.order_units), float(r.order_weight_kg),
                  float(r.order_volume_m3), int(r.deferred_yesterday), int(r.days_since_last_served))
            for r in s1_table().itertuples()]


def s1_status() -> dict:
    f = pd.read_csv(DATA_DIR / "Test Data" / "task2b_peak_day_fleet.csv")
    return dict(zip(f.vehicle_id, f.status))


def write_2b_submission(plan: Plan, path) -> None:
    served = plan.served
    rows = [{"scenario": "S1", "order_ref": r.order_ref, "outlet_id": r.outlet_id,
             "decision": "served" if r.order_ref in served else "deferred",
             "vehicle_id": served[r.order_ref][0] if r.order_ref in served else "",
             "trip_id": served[r.order_ref][1] if r.order_ref in served else ""} for r in s1_table().itertuples()]
    pd.DataFrame(rows).to_csv(path, index=False)


def run_checker(path) -> tuple:
    """Runs the organisers' check_allocation.py. Returns (passed, output)."""
    out = subprocess.run([sys.executable, str(CHECKER), str(path)], capture_output=True, text=True)
    return out.returncode == 0, (out.stdout + out.stderr).strip()


# ---------------------------------------------------------------- historical days
def depot_status(depot: str, workshop=()) -> dict:
    return {v: ("in_workshop" if v in workshop else "available") for v in sorted(VEHICLES) if VEHICLES[v].depot == depot}


def day_orders(day: str, depot: str) -> list:
    """Orders requested for `day`, with fairness fields computed from the order history before that day."""
    d = deliveries()
    today = d[(d.order_date == day) & (d.depot == depot)]
    prev = previous_operating_day(day)
    prev_run = d[d.order_date == prev]
    skipped = set(prev_run[prev_run.dispatch_status != "attempted"].outlet_id)            # skipped on the previous run
    served = d[(d.dispatch_date < day) & d.dispatch_date.notna()].groupby("outlet_id").dispatch_date.max()
    out = []
    for r in today.itertuples():
        last = served.get(r.outlet_id)
        days = (pd.Timestamp(day) - pd.Timestamp(last)).days if isinstance(last, str) else 7
        out.append(Order(r.delivery_id, r.outlet_id, r.temp_requirement, int(r.order_units), float(r.order_weight_kg),
                         float(r.order_volume_m3), int(r.outlet_id in skipped), max(days, 1)))
    return out


def weekly_fuel_used(day: str, depot: str) -> dict:
    """Litres each vehicle burned earlier in the same ISO week (route legs + return leg)."""
    c = CALENDAR[day]
    week = [x for x, v in CALENDAR.items() if (v["iso_year"], v["iso_week"]) == (c["iso_year"], c["iso_week"]) and x < day]
    lg = legs()
    lg = lg[lg.date.isin(week) & (lg.depot == depot)]
    r = lg.groupby(["route_id", "vehicle_id", "district"]).distance_km.sum().reset_index()
    r["litres"] = (r.distance_km + r.district.map(lambda x: DISTRICTS[x].depot_km)) / r.vehicle_id.map(lambda v: VEHICLES[v].km_per_l)
    return r.groupby("vehicle_id").litres.sum().to_dict()


def history_summary(day: str, depot: str) -> dict:
    d = deliveries(); lg = legs()
    today = d[(d.order_date == day) & (d.depot == depot)]
    run = lg[(lg.date == day) & (lg.depot == depot)]
    late = sum(hhmm_to_min(a) > OUTLETS[o].close for a, o in zip(run.arrival_time, run.to_outlet))
    return {"orders": len(today), "routes": run.route_id.nunique(), "vehicles": run.vehicle_id.nunique(),
            "deferred": int((today.dispatch_status != "attempted").sum()), "late_stops": int(late)}


# ---------------------------------------------------------------- recorded routes
def route_orders(route_id: str) -> list:
    """Orders of a recorded route, in the recorded stop order."""
    d = deliveries()
    r = d[d.route_id == route_id].sort_values("seq_in_route")
    return [Order(x.delivery_id, x.outlet_id, x.temp_requirement, int(x.order_units), float(x.order_weight_kg), float(x.order_volume_m3))
            for x in r.itertuples()]


def route_legs(route_id: str) -> pd.DataFrame:
    lg = legs()
    return lg[lg.route_id == route_id].sort_values("seq")
