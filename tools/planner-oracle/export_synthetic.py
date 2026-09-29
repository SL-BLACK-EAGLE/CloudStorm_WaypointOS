"""Synthetic golden fixtures: parity with the Python oracle without the confidential dataset.

The competition data may not be published (booklet p.22), so CI cannot use it. This script
invents a small operation with the same file layout - two depots, districts, outlets with
every dock/parking/window combination, a mixed fleet, a calendar, road and traffic tables -
seeded and fully deterministic, then runs the oracle on a peak day where demand exceeds
capacity and writes the same golden JSON the TypeScript parity tests read.

    python export_synthetic.py            # -> packages/planner/test/synthetic/*.json

CI runs it and fails if the committed fixtures differ from what the oracle produces.
"""
from __future__ import annotations

import json
import os
import random
import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent
OUT = Path(os.environ.get("SYNTH_GOLDEN_DIR") or HERE.parents[1] / "packages" / "planner" / "test" / "synthetic")
RUN_DATE = "2026-01-15"  # a Thursday


def write(path: Path, obj) -> None:
    """Stable JSON with LF endings on every OS, so CI can diff it against the committed fixtures."""
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(obj, indent=0, sort_keys=True))
        f.write("\n")


def hhmm(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def make_data(root: Path) -> None:
    rnd = random.Random(2026)
    gen = root / "General Data"
    gen.mkdir(parents=True, exist_ok=True)

    depots = {"North": ["N-Harbour", "N-Hills", "N-Coast", "N-Plains"], "South": ["S-River", "S-Valley", "S-Lake"]}
    districts = []
    for depot, names in depots.items():
        for i, d in enumerate(names):
            out_min = [22, 48, 85, 120][i] if depot == "North" else [30, 70, 105][i]
            districts.append({
                "district": d, "depot": depot, "depot_to_district_freeflow_min": out_min,
                "inter_stop_freeflow_min": rnd.choice([8, 10, 12, 14]),
                "depot_to_district_km": round(out_min * rnd.uniform(0.55, 0.8), 1),
                "inter_stop_km": round(rnd.uniform(3, 9), 1), "free_flow_kmh": rnd.choice([35, 40, 45, 50]),
            })
    pd.DataFrame(districts).to_csv(gen / "district_travel.csv", index=False)

    outlets = []
    n = 0
    for brand, count in [("Fresh", 26), ("Style", 9), ("Tech", 7)]:
        for k in range(count):
            n += 1
            d = districts[(k * 3 + len(outlets)) % len(districts)]
            dock = ["rear_dock", "street", "mall_bay"][k % 3]
            parking = "mall_dock" if dock == "mall_bay" else ("van_only" if k % 5 == 1 else "normal")
            if brand == "Fresh":
                open_, close = (6 * 60, 9 * 60) if parking == "mall_dock" else (rnd.choice([3 * 60, 4 * 60, 5 * 60]), rnd.choice([7 * 60 + 30, 8 * 60]))
            else:
                open_, close = (10 * 60, 20 * 60) if parking == "mall_dock" else (9 * 60, rnd.choice([16 * 60, 17 * 60, 18 * 60]))
            outlets.append({"outlet_id": f"SYN{n:03d}", "brand": brand, "district": d["district"], "depot": d["depot"],
                            "dock_type": dock, "parking_constraint": parking,
                            "window_open_time": hhmm(open_), "window_close_time": hhmm(close)})
    pd.DataFrame(outlets).to_csv(gen / "outlets.csv", index=False)

    vehicles = []
    specs = [  # type, temp, kg, m3, km/l, quota
        ("truck", "reefer", 3800, 20.0, 6.0, 420), ("truck", "reefer", 5200, 26.0, 4.8, 480),
        ("truck", "ambient", 4200, 24.0, 6.5, 460), ("truck", "ambient", 6200, 32.0, 5.2, 520),
        ("truck", "ambient", 3600, 19.0, 7.0, 400), ("van", "reefer", 1400, 8.5, 9.5, 300),
        ("van", "ambient", 1300, 9.0, 10.0, 280),
    ]
    v = 0
    for depot in depots:
        for spec in specs + ([specs[0], specs[3]] if depot == "North" else []):
            v += 1
            t, temp, kg, m3, kml, q = spec
            vehicles.append({"vehicle_id": f"SV{v:03d}", "type": t, "temp": temp, "weight_cap_kg": kg, "volume_cap_m3": m3,
                             "km_per_l": kml, "weekly_fuel_quota_l": q, "depot": depot})
    pd.DataFrame(vehicles).to_csv(gen / "vehicles.csv", index=False)

    allowance = []
    for brand, base in [("Fresh", 11), ("Style", 18), ("Tech", 24)]:
        for dock, extra in [("rear_dock", 0), ("street", 4), ("mall_bay", 9)]:
            allowance.append({"brand": brand, "dock_type": dock, "service_allowance_min": base + extra})
    pd.DataFrame(allowance).to_csv(gen / "service_allowance.csv", index=False)

    cal = []
    d0 = date(2026, 1, 1)
    for i in range(45):
        day = d0 + timedelta(days=i)
        iso = day.isocalendar()
        cal.append({"date": day.isoformat(), "is_operating": int(day.weekday() != 6), "monsoon": int(i % 9 == 4),
                    "festival_ramp": round(max(0.0, 1 - abs(i - 20) / 10) * 0.8, 2), "is_payday": int(day.day == 25),
                    "iso_year": iso[0], "iso_week": iso[1], "dow_name": day.strftime("%a")})
    pd.DataFrame(cal).to_csv(gen / "calendar.csv", index=False)

    speed = [{"district": d["district"], "hour": h, "monsoon": m,
              "speed_index": round(100 - (18 if h in (7, 8, 17, 18) else 6 if 9 <= h <= 16 else 0) - (8 if m else 0) - rnd.uniform(0, 4), 1)}
             for d in districts for h in range(24) for m in (0, 1)]
    pd.DataFrame(speed).to_csv(gen / "traffic_speed.csv", index=False)

    road = [{"district": d["district"], "date": c["date"], "disruption_index": round(rnd.uniform(82, 100), 1)} for d in districts for c in cal]
    pd.DataFrame(road).to_csv(gen / "road_conditions.csv", index=False)


def make_orders(outlets: dict, depot: str | None) -> list:
    from algorithm import Order

    rnd = random.Random(15)
    orders = []
    for oid in sorted(outlets):
        o = outlets[oid]
        if depot and o.depot != depot:
            continue
        temps = ["chilled", "ambient"] if o.brand == "Fresh" else ["ambient"]
        for temp in temps:
            if temp == "ambient" and o.brand == "Fresh" and rnd.random() < 0.35:
                continue
            units = rnd.randint(8, 140)
            kg = round(units * rnd.uniform(4, 11), 1)
            m3 = round(kg / rnd.uniform(160, 260), 3)
            orders.append(Order(f"SO-{oid}-{temp[0].upper()}", oid, temp, units, kg, m3,
                                int(rnd.random() < 0.12), rnd.randint(1, 5)))
    return orders


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        data = Path(tmp) / "data"
        make_data(data)
        os.environ["WAYPOINT_DATA_DIR"] = str(data)
        sys.path.insert(0, str(HERE))
        from algorithm import MODE_2B, MODE_LIVE, DayContext  # noqa: E402  (reads the synthetic data on import)
        import export_golden as eg  # noqa: E402
        from reference import OUTLETS, VEHICLES  # noqa: E402

        OUT.mkdir(parents=True, exist_ok=True)
        write(OUT / "reference.json", eg.reference_json())
        ctx = DayContext.for_date(RUN_DATE)
        everyone = {v: "available" for v in sorted(VEHICLES)}
        north = {v: s for v, s in everyone.items() if VEHICLES[v].depot == "North"}
        north_ws = {**north, "SV001": "in_workshop", "SV006": "in_workshop"}
        fuel = {"SV002": 360.0, "SV004": 120.0}
        scenarios = [
            eg.scenario("synth-peak-2b", make_orders(OUTLETS, None), everyone, ctx, MODE_2B),
            eg.scenario("synth-peak-live", make_orders(OUTLETS, None), everyone, ctx, MODE_LIVE, fuel),
            eg.scenario("synth-north-workshop", make_orders(OUTLETS, "North"), north_ws, ctx, MODE_LIVE, fuel),
        ]
        for sc in scenarios:
            write(OUT / f"plan-{sc['name']}.json", sc)
            p = sc["plan"]
            served = sum(len(t) for ts in p["trips"].values() for t in ts)
            print(f"{sc['name']}: {len(sc['orders'])} orders, {served} served, {len(p['deferrals'])} deferred")
        print(f"-> {OUT}")


if __name__ == "__main__":
    main()
