"""Simulation environment: run the algorithm on real data and print plans, leg timetables and deferrals.

  python run.py s1 [--mode 2B|LIVE] [--legs] [--out output/submission_task2b.csv]
  python run.py day 2025-12-23 Peliyagoda [--mode LIVE|2B] [--workshop VEH036,VEH001] [--legs]
  python run.py replay R023442          # F9: ETAs re-computed after every recorded event of a real route
  python run.py intake OUT006 ambient 601.7 3.428 2025-12-23 2025-12-22 14:20
"""
import argparse
from pathlib import Path

import datasets as ds
from algorithm import MODE_2B, MODE_LIVE, DayContext, intake, plan_day, reschedule_remaining
from reference import VEHICLES, hhmm_to_min as m, min_to_hhmm as hm


def print_plan(plan, orders, show_legs):
    by_ref = {o.ref: o for o in orders}
    chilled = [o for o in orders if o.temp == "chilled"]
    print(f"\n{plan.mode} plan: served {len(plan.served)}/{len(orders)} "
          f"(chilled {sum(o.ref in plan.served for o in chilled)}/{len(chilled)}), "
          f"{len(plan.timed)} trips on {len(plan.trips)} vehicles, {len(plan.deferrals)} deferred")
    for t in plan.timed:
        v = VEHICLES[t.vehicle_id]
        line = (f"  {t.vehicle_id} trip {t.number} {v.type}/{v.temp} | {t.stops[0].brand} {t.stops[0].district} | {len(t.stops)} stops | "
                f"{sum(o.kg for o in t.stops):.0f}/{v.cap_kg:.0f} kg | {sum(o.m3 for o in t.stops):.1f}/{v.cap_m3:.1f} m3 | "
                f"{t.trip_minutes} budget min | {t.litres:.1f} L")
        if t.departure is not None:
            line += f" | departs {hm(t.departure)}, back {hm(t.back_planned)}"
        print(line)
        if show_legs and t.departure is not None:
            print("      stop  order        outlet  window       planned  expected  flag")
            for k, (p, e) in enumerate(zip(t.planned, t.expected), 1):
                o = by_ref[p.ref]
                flag = "LATE" if e.late else "risk" if e.risk else "ok"
                print(f"      {k:>4}  {p.ref:<12} {o.outlet_id}  {hm(o.open)}-{hm(o.close)}  {hm(p.arrive)}    {hm(e.arrive)}     {flag}")
    for ref, d in sorted(plan.deferrals.items()):
        o = by_ref[ref]
        print(f"  DEFERRED {ref} {o.outlet_id} {o.district} {o.temp} {o.kg:.0f} kg -> {d.kind}: {d.reason}")


def cmd_s1(a):
    orders = ds.s1_orders()
    plan = plan_day(orders, ds.s1_status(), ds.S1_CONTEXT, a.mode)
    print_plan(plan, orders, a.legs)
    if a.mode == MODE_2B:
        out = Path(a.out); out.parent.mkdir(parents=True, exist_ok=True)
        ds.write_2b_submission(plan, out)
        passed, text = ds.run_checker(out)
        print(f"\nwrote {out}\nofficial checker: {text}")


def cmd_day(a):
    orders = ds.day_orders(a.date, a.depot)
    status = ds.depot_status(a.depot, [w for w in a.workshop.split(",") if w])
    plan = plan_day(orders, status, DayContext.for_date(a.date), a.mode, ds.weekly_fuel_used(a.date, a.depot))
    print(f"history on {a.date} {a.depot}: {ds.history_summary(a.date, a.depot)}")
    print_plan(plan, orders, a.legs)


def cmd_replay(a):
    stops, rec = ds.route_orders(a.route), ds.route_legs(a.route)
    ctx = DayContext.for_date(rec.date.iloc[0])
    print(f"{a.route} {rec.vehicle_id.iloc[0]} {rec.district.iloc[0]} {rec.date.iloc[0]}: planned departure {rec.planned_depart_time.iloc[0]}, "
          f"actual {rec.actual_depart_time.iloc[0]}")
    events = [("departed", m(rec.actual_depart_time.iloc[0]))] + [(f"left {o}", m(t)) for o, t in zip(rec.to_outlet, rec.leave_outlet_time)]
    done = []
    for k, (label, now) in enumerate(events):
        if k:
            done.append((m(rec.arrival_time.iloc[k - 1]), now))
        etas = reschedule_remaining(stops, done, now, ctx)
        if not etas:
            break
        text = ", ".join(f"{e.outlet_id} {hm(e.eta)}{' LATE' if e.late else ' risk' if e.risk else ''}" for e in etas)
        print(f"  after {label} at {hm(now)} -> {text}")
    print("  actual arrivals: " + ", ".join(f"{o} {t}" for o, t in zip(rec.to_outlet, rec.arrival_time)))


def cmd_intake(a):
    print(intake(a.outlet, a.temp, a.kg, a.m3, a.requested, a.received_date, a.received_time))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("s1", help="plan the Task 2B peak day")
    s.add_argument("--mode", choices=[MODE_2B, MODE_LIVE], default=MODE_2B)
    s.add_argument("--legs", action="store_true", help="print leg timetables (LIVE mode)")
    s.add_argument("--out", default="output/submission_task2b.csv")
    s.set_defaults(fn=cmd_s1)
    d = sub.add_parser("day", help="plan a historical day for one depot")
    d.add_argument("date"); d.add_argument("depot", choices=["Peliyagoda", "Kandy"])
    d.add_argument("--mode", choices=[MODE_2B, MODE_LIVE], default=MODE_LIVE)
    d.add_argument("--workshop", default="", help="comma-separated vehicle IDs in the workshop")
    d.add_argument("--legs", action="store_true")
    d.set_defaults(fn=cmd_day)
    r = sub.add_parser("replay", help="live re-scheduling on a recorded route")
    r.add_argument("route")
    r.set_defaults(fn=cmd_replay)
    i = sub.add_parser("intake", help="run F1 on one order")
    for name in ("outlet", "temp"):
        i.add_argument(name)
    i.add_argument("kg", type=float); i.add_argument("m3", type=float)
    for name in ("requested", "received_date", "received_time"):
        i.add_argument(name)
    i.set_defaults(fn=cmd_intake)
    a = p.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
