"""Reference data from datasets/data, read once into plain dicts for fast lookups.

Set WAYPOINT_DATA_DIR to point at another copy of the data folder.
"""
import os
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

import params as P

DATA_DIR = Path(os.environ.get("WAYPOINT_DATA_DIR") or Path(__file__).resolve().parent.parent / "datasets" / "data")


def hhmm_to_min(s: str) -> int:
    return int(s[:2]) * 60 + int(s[3:5])


def min_to_hhmm(t: float) -> str:
    t = int(round(t))
    return f"{t // 60:02d}:{t % 60:02d}"


@dataclass(frozen=True)
class Outlet:
    id: str
    brand: str
    district: str
    depot: str
    dock: str        # rear_dock | street | mall_bay
    parking: str     # normal | van_only | mall_dock
    open: int        # window open, minutes after midnight (mall window for mall outlets)
    close: int       # window close


@dataclass(frozen=True)
class Vehicle:
    id: str
    type: str        # truck | van
    temp: str        # reefer | ambient
    cap_kg: float
    cap_m3: float
    km_per_l: float
    weekly_quota_l: float
    depot: str

    @property
    def capability_cost(self) -> int:
        return P.CAPABILITY_COST["reefer"] * (self.temp == "reefer") + P.CAPABILITY_COST["van"] * (self.type == "van")


@dataclass(frozen=True)
class District:
    name: str
    depot: str
    outbound_min: int      # depot_to_district_freeflow_min
    inter_stop_min: int    # inter_stop_freeflow_min
    depot_km: float
    inter_stop_km: float
    free_flow_kmh: float


def _read(folder: str, name: str) -> pd.DataFrame:
    return pd.read_csv(DATA_DIR / folder / name)


OUTLETS = {r.outlet_id: Outlet(r.outlet_id, r.brand, r.district, r.depot, r.dock_type, r.parking_constraint,
                               hhmm_to_min(r.window_open_time), hhmm_to_min(r.window_close_time))
           for r in _read("General Data", "outlets.csv").itertuples()}

VEHICLES = {r.vehicle_id: Vehicle(r.vehicle_id, r.type, r.temp, float(r.weight_cap_kg), float(r.volume_cap_m3),
                                  float(r.km_per_l), float(r.weekly_fuel_quota_l), r.depot)
            for r in _read("General Data", "vehicles.csv").itertuples()}

DISTRICTS = {r.district: District(r.district, r.depot, int(r.depot_to_district_freeflow_min), int(r.inter_stop_freeflow_min),
                                  float(r.depot_to_district_km), float(r.inter_stop_km), float(r.free_flow_kmh))
             for r in _read("General Data", "district_travel.csv").itertuples()}

ALLOWANCE = {(r.brand, r.dock_type): int(r.service_allowance_min) for r in _read("General Data", "service_allowance.csv").itertuples()}

CALENDAR = {r.date: {"is_operating": int(r.is_operating), "monsoon": int(r.monsoon), "festival_ramp": float(r.festival_ramp),
                     "is_payday": int(r.is_payday), "iso_year": int(r.iso_year), "iso_week": int(r.iso_week), "dow_name": r.dow_name}
            for r in _read("General Data", "calendar.csv").itertuples()}

SPEED = {(r.district, int(r.hour), int(r.monsoon)): float(r.speed_index) for r in _read("General Data", "traffic_speed.csv").itertuples()}

DISRUPTION = {(r.district, r.date): float(r.disruption_index) for r in _read("General Data", "road_conditions.csv").itertuples()}
