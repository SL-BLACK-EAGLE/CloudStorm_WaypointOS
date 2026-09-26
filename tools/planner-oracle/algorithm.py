"""Waypoint delivery planning and route-leg scheduling: the complete algorithm.

Implements docs/Delivery_Planning_Flowchart.md one-to-one. Section headers name the chart (M, F1..F9)
and comments name its nodes (A1, B3, E12, ...), so a test case can be traced through chart and code.

Entry points
    intake(...)              F1  accept / move / reject one order
    plan_day(...)            M   F2 -> F3 -> F4 -> F8 -> timed plan (the whole planning run)
    check_vehicle_day(...)   F5  validate one vehicle's day (also for dispatcher edits)
    schedule(...)            F6  leg-by-leg timing of one trip
    departure_time(...)      F7  when a trip should leave
    reschedule_remaining(...), project_position(...), sync_event(...)   F9 live operations
"""
from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass, field
from datetime import date as _date, timedelta

import params as P
from reference import ALLOWANCE, CALENDAR, DISRUPTION, DISTRICTS, OUTLETS, SPEED, VEHICLES, hhmm_to_min

MODE_2B, MODE_LIVE = "2B", "LIVE"            # booklet rules only | rules + clock time + fuel + risk
PLANNED, EXPECTED = "planned", "expected"    # time models (section 1 of the flowchart)


# ============================================================ data model
@dataclass(eq=False)          # identity semantics: two orders are never 'equal' by value
class Order:
    ref: str
    outlet_id: str
    temp: str                       # chilled | ambient
    units: int
    kg: float
    m3: float
    deferred_yesterday: int = 0     # 1 if the outlet was skipped on the previous run
    days_since_last_served: int = 1

    def __post_init__(self):
        self.outlet = OUTLETS[self.outlet_id]

    brand = property(lambda self: self.outlet.brand)
    district = property(lambda self: self.outlet.district)
    depot = property(lambda self: self.outlet.depot)
    dock = property(lambda self: self.outlet.dock)
    parking = property(lambda self: self.outlet.parking)
    open = property(lambda self: self.outlet.open)
    close = property(lambda self: self.outlet.close)
    bucket = property(lambda self: (self.outlet.brand, self.outlet.district))

    def __repr__(self):
        return self.ref


@dataclass
class DayContext:
    """Calendar and road context for EXPECTED times."""
    date: str | None = None
    monsoon: int = 0
    festival_ramp: float = 0.0
    payday: int = 0
    disruption: dict = field(default_factory=dict)   # district -> index, 100 = clear

    @classmethod
    def for_date(cls, day: str) -> "DayContext":
        c = CALENDAR[day]
        return cls(day, c["monsoon"], c["festival_ramp"], c["is_payday"], {d: DISRUPTION[(d, day)] for d in DISTRICTS})


@dataclass
class Leg:
    ref: str
    outlet_id: str
    depart: float
    travel: float
    arrive: float
    wait: float
    start: float
    service: float
    leave: float
    close: int
    slack: float     # close - arrive
    late: bool       # arrive > close
    risk: bool       # EXPECTED only: close - arrive < risk margin


@dataclass
class Check:
    ok: bool
    code: str | None = None        # first failing rule, None when ok
    timed: list | None = None      # [(sequenced stops, departure T0)] in driving order; T0 None in 2B mode


@dataclass
class Deferral:
    ref: str
    kind: str                      # UNAVOIDABLE | CAPACITY_FORCED | CHOSEN
    reason: str
    lost_to: str | None = None


@dataclass
class TimedTrip:
    vehicle_id: str
    number: int
    stops: list
    departure: float | None
    trip_minutes: int
    litres: float
    planned: list = field(default_factory=list)
    back_planned: float | None = None
    expected: list = field(default_factory=list)
    back_expected: float | None = None


@dataclass
class Plan:
    mode: str
    trips: dict                    # vehicle_id -> [trip, trip], each trip a list of Orders
    deferrals: dict                # order ref -> Deferral
    timed: list                    # [TimedTrip] ready to publish

    @property
    def served(self) -> dict:
        """order ref -> (vehicle, trip number in driving order)."""
        return {o.ref: (t.vehicle_id, t.number) for t in self.timed for o in t.stops}


# ============================================================ shared formulas (P06, P17)
def window(brand: str) -> str:
    return "Fresh" if brand == "Fresh" else "Day"


def trip_minutes(brand: str, district: str, docks: list) -> int:
    """P06 booklet budget formula = check_allocation.py: outbound + (stops-1) x inter-stop + sum of allowances."""
    d = DISTRICTS[district]
    return d.outbound_min + (len(docks) - 1) * d.inter_stop_min + sum(ALLOWANCE[(brand, k)] for k in docks)


def litres(trip: list, vehicle_id: str) -> float:
    """P17 fuel for one trip, return leg included."""
    d = DISTRICTS[trip[0].district]
    return (2 * d.depot_km + (len(trip) - 1) * d.inter_stop_km) / VEHICLES[vehicle_id].km_per_l


# ============================================================ F1 order intake and cutoff
def is_operating(day: str) -> bool:
    return CALENDAR[day]["is_operating"] == 1


def _step(day: str, days: int) -> str:
    return (_date.fromisoformat(day) + timedelta(days=days)).isoformat()


def next_operating_day(day: str) -> str:
    day = _step(day, 1)
    while not is_operating(day):
        day = _step(day, 1)
    return day


def previous_operating_day(day: str) -> str:
    day = _step(day, -1)
    while not is_operating(day):
        day = _step(day, -1)
    return day


def intake(outlet_id, temp, kg, m3, requested_date, received_date, received_time):
    """F1. Returns (status, run_date, reason)."""
    outlet = OUTLETS[outlet_id]
    if outlet.brand != "Fresh" and temp == "chilled":                                           # A1
        return "REJECT", None, "ONLY_FRESH_CAN_BE_CHILLED"                                      # A2
    fleet = [v for v in VEHICLES.values() if v.depot == outlet.depot                             # A3
             and (outlet.parking != "van_only" or v.type == "van") and (temp != "chilled" or v.temp == "reefer")]
    if not any(kg <= v.cap_kg and m3 <= v.cap_m3 for v in fleet):                                # A4
        return "REJECT", None, "SPLIT_ORDER_EXCEEDS_LARGEST_VEHICLE"                            # A5
    run, reasons = requested_date, []
    if not is_operating(run):                                                                    # A6
        run = next_operating_day(run)                                                            # A7
        reasons.append("NON_OPERATING_DAY")
    cutoff_day = previous_operating_day(run)                                                     # A9
    if (received_date, hhmm_to_min(received_time)) > (cutoff_day, P.CUTOFF_MIN):                  # A10
        run = next_operating_day(run)                                                            # A11
        reasons.append("AFTER_CUTOFF")
    return "CONFIRMED", run, "+".join(reasons) or "ON_TIME"                                      # A12


# ============================================================ F2 eligibility
def check_vehicle(order: Order, vehicle_id: str, status: dict) -> str | None:
    """B1-B7 in fixed order. None = eligible, otherwise the first failing code."""
    v = VEHICLES[vehicle_id]
    if status.get(vehicle_id) != "available":
        return "IN_WORKSHOP"                                                                     # B1
    if v.depot != order.depot:
        return "WRONG_DEPOT"                                                                     # B2
    if order.temp == "chilled" and v.temp != "reefer":
        return "NEEDS_REEFER"                                                                    # B3
    if order.parking == "van_only" and v.type != "van":
        return "NEEDS_VAN"                                                                       # B4
    if order.kg > v.cap_kg:
        return "OVER_WEIGHT"                                                                     # B5
    if order.m3 > v.cap_m3:
        return "OVER_VOLUME"                                                                     # B6
    if trip_minutes(order.brand, order.district, [order.dock]) > P.TIME_BUDGET[window(order.brand)]:
        return "OVER_TIME_BUDGET"                                                                # B7
    return None                                                                                  # BOK


def eligible_vehicles(order: Order, status: dict) -> list:
    """BL loop over the depot's vehicles, in vehicle-ID order."""
    return [vid for vid in sorted(VEHICLES) if VEHICLES[vid].depot == order.depot and check_vehicle(order, vid, status) is None]


def unavoidable_reason(order: Order, status: dict) -> str:
    """R1-R5, asked only when no vehicle is eligible."""
    depot = [v for v in VEHICLES.values() if v.depot == order.depot]
    avail = [v for v in depot if status.get(v.id) == "available"]
    if not any(order.kg <= v.cap_kg and order.m3 <= v.cap_m3 for v in depot):
        return "EXCEEDS_EVERY_VEHICLE"                                                           # R1
    if order.temp == "chilled" and not any(v.temp == "reefer" for v in avail):
        return "NO_REEFER_AVAILABLE"                                                             # R2
    if order.parking == "van_only" and not any(v.type == "van" for v in avail):
        return "NO_VAN_AVAILABLE"                                                                # R3
    if order.temp == "chilled" and order.parking == "van_only" and not any(v.type == "van" and v.temp == "reefer" for v in avail):
        return "NO_REEFER_VAN_AVAILABLE"                                                         # R4
    return "NO_VEHICLE_FITS_ORDER"                                                               # R5


# ============================================================ F3 priority weight and class
def weight(order: Order) -> float:
    """C1 (P19)."""
    return (P.WEIGHT_DEFERRED_YESTERDAY * order.deferred_yesterday + P.WEIGHT_PER_DAY_UNSERVED * order.days_since_last_served
            + P.WEIGHT_CHILLED * (order.temp == "chilled") + P.WEIGHT_PER_M3 * order.m3)


def order_class(order: Order) -> int:
    """C2-C8 (P20): 0 van-only chilled, 1 chilled, 2 van-only ambient, 3 everything else."""
    if order.temp == "chilled":
        return 0 if order.parking == "van_only" else 1
    return 2 if order.parking == "van_only" else 3


def _by_weight(order: Order):
    return (-weight(order), order.ref)                                                          # C9


# ============================================================ F6 route-leg scheduling
def sequence(stops: list) -> list:
    """G1: window close ascending, then window open, then outlet ID (then order ref)."""
    return sorted(stops, key=lambda o: (o.close, o.open, o.outlet_id, o.ref))


def leg_minutes(district: str, first_leg: bool, t: float, ctx: DayContext, model: str) -> float:
    """G6-G9."""
    d = DISTRICTS[district]
    base = d.outbound_min if first_leg else d.inter_stop_min                                     # G6
    if model == PLANNED:
        return float(base)                                                                       # G8
    hour = min(int(t // 60), 23)                                                                 # G9
    return base * (100 / SPEED[(district, hour, ctx.monsoon)]) * (100 / ctx.disruption.get(district, 100)) * P.TRAVEL_FACTOR


def service_minutes(order: Order, ctx: DayContext, model: str) -> float:
    """G19 / G20 (P08, P14)."""
    if model == PLANNED:
        return float(ALLOWANCE[(order.brand, order.dock)])                                       # G19
    s = P.SERVICE_MODEL[order.brand]                                                             # G20
    return max(P.MIN_SERVICE_MIN, s["base"][order.dock] + s["u"] * order.units + s["f"] * ctx.festival_ramp
               + s["p"] * ctx.payday + s["m"] * ctx.monsoon)


def schedule(stops: list, departure: float, ctx: DayContext, model: str, keep_order: bool = False):
    """F6: timed legs for one trip. keep_order=True only to replay a recorded stop order."""
    stops = stops if keep_order else sequence(stops)                                             # G1
    t = departure + (P.DEPOT_DELAY_MIN if model == EXPECTED else 0)                              # G2-G4
    legs = []
    for k, o in enumerate(stops):                                                                # G5 / G23
        travel = leg_minutes(o.district, k == 0, t, ctx, model)                                  # G6-G9
        arrive = t + travel                                                                      # G10
        slack = o.close - arrive
        late = arrive > o.close                                                                  # G11-G12
        risk = model == EXPECTED and not late and slack < P.RISK_MARGIN_MIN                      # G13-G14
        start = max(arrive, o.open)                                                              # G15-G17
        svc = service_minutes(o, ctx, model)                                                     # G18-G20
        leave = start + svc                                                                      # G21
        legs.append(Leg(o.ref, o.outlet_id, t, travel, arrive, start - arrive, start, svc, leave, o.close, slack, late, risk))
        t = leave                                                                                # G23
    back = t + leg_minutes(stops[-1].district, True, t, ctx, model)                              # G24
    return legs, back


# ============================================================ F7 departure time
def departure_time(stops: list, ready: float, ctx: DayContext) -> float:
    """F7 for sequenced stops: reach the first stop as it opens, leave earlier only to keep the risk margin."""
    first = stops[0]
    t0 = max(ready, first.open - DISTRICTS[first.district].outbound_min)                         # H1-H2
    for _ in range(P.DEPARTURE_PULLBACK_ATTEMPTS):                                               # H3
        legs, _ = schedule(stops, t0, ctx, EXPECTED, keep_order=True)                            # H4
        shortfall = max(P.RISK_MARGIN_MIN - leg.slack for leg in legs)                           # H5
        if shortfall <= 0 or t0 <= ready:                                                        # H6
            break
        t0 = max(ready, math.floor(t0 - shortfall))                                              # H7
    return t0                                                                                    # H8


# ============================================================ F5 vehicle-day feasibility
def _trip_orderings(seqs: list) -> list:
    """E13: Fresh trips before Style/Tech trips; two trips in the same window are tried both ways."""
    fresh = [s for s in seqs if s[0].brand == "Fresh"]
    day = [s for s in seqs if s[0].brand != "Fresh"]
    out = [fresh + day]
    if len(fresh) == 2:
        out.append(fresh[::-1] + day)
    if len(day) == 2:
        out.append(fresh + day[::-1])
    return out


def check_vehicle_day(vehicle_id: str, trips: list, ctx: DayContext, mode: str, fuel_used_l: float = 0.0) -> Check:
    """F5: every rule for one vehicle's whole day, in fixed order. The first failure is returned."""
    v = VEHICLES[vehicle_id]
    if len(trips) > P.MAX_TRIPS:
        return Check(False, "R7_TRIP_LIMIT")                                                     # E1 / X1
    used = {"Fresh": 0, "Day": 0}
    for trip in trips:                                                                           # E2
        brand, district = trip[0].bucket
        if any(o.bucket != (brand, district) for o in trip):
            return Check(False, "R1_BRAND_DISTRICT")                                             # E3 / X2
        if any((o.temp == "chilled" and v.temp != "reefer") or (o.parking == "van_only" and v.type != "van")
               or o.depot != v.depot for o in trip):
            return Check(False, "R2_R3_R4_VEHICLE_TYPE")                                         # E4 / X3
        if sum(o.kg for o in trip) > v.cap_kg + 1e-9:
            return Check(False, "R6_WEIGHT")                                                     # E5 / X4
        if sum(o.m3 for o in trip) > v.cap_m3 + 1e-9:
            return Check(False, "R6_VOLUME")                                                     # E6 / X5
        used[window(brand)] += trip_minutes(brand, district, [o.dock for o in trip])             # E7
    if used["Fresh"] > P.TIME_BUDGET["Fresh"]:
        return Check(False, "R7_FRESH_BUDGET_270")                                               # E9 / X6
    if used["Day"] > P.TIME_BUDGET["Day"]:
        return Check(False, "R7_DAY_BUDGET_480")                                                 # E10 / X7
    if mode == MODE_2B:
        return Check(True, None, [(sequence(t), None) for t in trips])                           # E11 / PASS1
    if sum(litres(t, vehicle_id) for t in trips) > v.weekly_quota_l - fuel_used_l + 1e-9:
        return Check(False, "FUEL_QUOTA")                                                        # E12 / X8
    code = "WINDOW_LATE"
    for ordering in _trip_orderings([sequence(t) for t in trips]):                               # E13 / E20
        ready, timed = None, []
        for k, stops in enumerate(ordering):
            earliest = P.EARLIEST_DEPARTURE[stops[0].brand]
            start_from = earliest if ready is None else max(earliest, ready)                     # E14 / E19
            t0 = departure_time(stops, start_from, ctx)                                          # E15
            legs, back = schedule(stops, t0, ctx, PLANNED, keep_order=True)                      # E16
            if any(leg.late for leg in legs):                                                    # E17
                code = "WINDOW_LATE" if k == 0 else "TRIP2_WINDOW_LATE"
                break
            timed.append((stops, t0))
            ready = back + P.RELOAD_MIN                                                          # E18 / E19
        else:
            return Check(True, None, timed)                                                      # PASS2
    return Check(False, code)                                                                    # X9


# ============================================================ F4 trip construction
def build_trips(orders: list, eligible: dict, fleet: list, ctx: DayContext, mode: str, fuel_used: dict):
    """F4: commit the best whole trip each step, scarcest class first. Returns (trips, still_open)."""
    trips = {v: [] for v in fleet}
    open_ = list(orders)
    feasible = lambda v, day: check_vehicle_day(v, day, ctx, mode, fuel_used.get(v, 0.0)).ok
    for c in range(len(P.CLASS_NAMES)):                                                          # D1 / D19-D20
        while True:
            best = None                                                                          # D2
            for v in fleet:                                                                      # D3 (vehicle-ID order)
                if len(trips[v]) >= P.MAX_TRIPS:
                    continue
                buckets = {}
                for o in open_:                                                                  # D4
                    if order_class(o) == c and v in eligible[o.ref]:
                        buckets.setdefault(o.bucket, []).append(o)
                for bucket in sorted(buckets):
                    cand = []                                                                    # D5
                    for o in sorted(buckets[bucket], key=_by_weight):                            # D6
                        if feasible(v, trips[v] + [cand + [o]]):                                 # D7
                            cand.append(o)                                                       # D8
                    if not cand:                                                                 # D11
                        continue
                    minutes = trip_minutes(*bucket, [o.dock for o in cand])
                    score = sum(weight(o) for o in cand) / minutes                               # D12
                    spare = P.TIME_BUDGET[window(bucket[0])] - minutes - sum(
                        trip_minutes(*t[0].bucket, [o.dock for o in t]) for t in trips[v] if window(t[0].brand) == window(bucket[0]))
                    rank = (round(score, 9), -VEHICLES[v].capability_cost, -spare, -VEHICLES[v].cap_m3)
                    if best is None or rank > best[0]:                                           # D13: ties keep lower ID, then bucket
                        best = (rank, v, cand)                                                   # D14
            if best is None:                                                                     # D17
                break
            _, v, cand = best
            trips[v].append(cand)                                                                # D18
            open_ = [o for o in open_ if o not in cand]
    return trips, open_


# ============================================================ F8 repair and classify
def _with(trips_v: list, i: int, new_trip: list) -> list:
    return [new_trip if j == i else t for j, t in enumerate(trips_v)]


def repair_and_classify(trips: dict, open_: list, eligible: dict, unavoidable: dict, ctx: DayContext, mode: str, fuel_used: dict) -> dict:
    """F8. Mutates trips; returns order ref -> Deferral."""
    check = lambda v, day: check_vehicle_day(v, day, ctx, mode, fuel_used.get(v, 0.0))
    open_ = list(open_)
    for o in sorted(open_, key=_by_weight):                                                      # J1
        placed = False
        for v in eligible[o.ref]:                                                                # J2: vehicles by ID, trips in order
            for i, t in enumerate(trips[v]):
                if t[0].bucket == o.bucket and check(v, _with(trips[v], i, t + [o])).ok:
                    trips[v] = _with(trips[v], i, t + [o]); placed = True
                    break
            if placed:
                break
        if not placed:                                                                           # J4
            for v in eligible[o.ref]:
                if len(trips[v]) < P.MAX_TRIPS and check(v, trips[v] + [[o]]).ok:
                    trips[v] = trips[v] + [[o]]; placed = True
                    break
        if not placed:                                                                           # J5: swap out a lighter order
            for v in eligible[o.ref]:
                for i, t in enumerate(trips[v]):
                    if t[0].bucket != o.bucket:
                        continue
                    for q in sorted(t, key=weight):
                        if weight(q) >= weight(o):
                            break
                        swapped = [x for x in t if x is not q] + [o]
                        if check(v, _with(trips[v], i, swapped)).ok:
                            trips[v] = _with(trips[v], i, swapped); open_.append(q); placed = True  # J6
                            break
                    if placed:
                        break
                if placed:
                    break
        if placed:
            open_.remove(o)                                                                      # J3
    deferrals = {ref: Deferral(ref, "UNAVOIDABLE", why) for ref, why in unavoidable.items()}
    for o in open_:                                                                              # J7-J9
        lost_to, failures = None, Counter()
        for v in eligible[o.ref]:
            for i, t in enumerate(trips[v]):
                if t[0].bucket != o.bucket:
                    continue
                for q in t:
                    if weight(q) >= weight(o) and check(v, _with(trips[v], i, [x for x in t if x is not q] + [o])).ok:
                        lost_to = q.ref
                        break
                if lost_to:
                    break
                failures[check(v, _with(trips[v], i, t + [o])).code] += 1
            if lost_to:
                break
            if len(trips[v]) < P.MAX_TRIPS:
                failures[check(v, trips[v] + [[o]]).code] += 1
            else:
                failures["R7_TRIP_LIMIT"] += 1
        if lost_to:
            deferrals[o.ref] = Deferral(o.ref, "CHOSEN", f"lost to {lost_to}", lost_to)          # J8
        else:
            deferrals[o.ref] = Deferral(o.ref, "CAPACITY_FORCED", failures.most_common(1)[0][0] if failures else "NO_SLOT")  # J9
    return deferrals


# ============================================================ M master flow: one planning run
def plan_day(orders: list, status: dict, ctx: DayContext, mode: str = MODE_LIVE, fuel_used: dict | None = None) -> Plan:
    """M3-M15: eligibility -> weight -> trip construction -> repair -> timed plan ready to publish."""
    fuel_used = fuel_used or {}
    fleet = sorted(v for v, s in status.items() if s == "available")
    eligible, unavoidable = {}, {}
    for o in orders:                                                                             # M9
        eligible[o.ref] = eligible_vehicles(o, status)
        if not eligible[o.ref]:                                                                  # M10
            unavoidable[o.ref] = unavoidable_reason(o, status)                                   # M11
    candidates = [o for o in orders if o.ref not in unavoidable]                                 # M12
    trips, open_ = build_trips(candidates, eligible, fleet, ctx, mode, fuel_used)                # M13
    deferrals = repair_and_classify(trips, open_, eligible, unavoidable, ctx, mode, fuel_used)   # M14
    trips = {v: t for v, t in trips.items() if t}
    return Plan(mode, trips, deferrals, time_plan(trips, ctx, mode, fuel_used))                  # M15


def time_plan(trips: dict, ctx: DayContext, mode: str, fuel_used: dict | None = None) -> list:
    """Departure, PLANNED and EXPECTED legs for every trip, in driving order."""
    out = []
    for v, ts in sorted(trips.items()):
        chk = check_vehicle_day(v, ts, ctx, mode, (fuel_used or {}).get(v, 0.0))
        for k, (stops, t0) in enumerate(chk.timed, 1):
            tt = TimedTrip(v, k, stops, t0, trip_minutes(*stops[0].bucket, [o.dock for o in stops]), litres(stops, v))
            if t0 is not None:
                tt.planned, tt.back_planned = schedule(stops, t0, ctx, PLANNED, keep_order=True)
                tt.expected, tt.back_expected = schedule(stops, t0, ctx, EXPECTED, keep_order=True)
            out.append(tt)
    return out


# ============================================================ M16-M23 publish, dock, end of day
def load_list(trip: TimedTrip) -> list:
    """M16: last stop is loaded first."""
    return [o.ref for o in reversed(trip.stops)]


def dock_signoff(open_shortfalls: int, dispatcher_decision: str | None) -> str:
    """M19-M21: sign-off stays locked while a shortfall has no dispatcher decision (HOLD or SEND_AND_WARN)."""
    if open_shortfalls == 0:
        return "RELEASED"
    return "LOCKED" if dispatcher_decision is None else f"RELEASED_{dispatcher_decision}"


def carry_over(plan: Plan, orders: list) -> list:
    """M23: deferred orders join the next run with deferred_yesterday = 1."""
    # an order bigger than every vehicle is not carried: the store has to split it (F1 A5)
    return [Order(o.ref, o.outlet_id, o.temp, o.units, o.kg, o.m3, 1, o.days_since_last_served + 1)
            for o in orders if o.ref in plan.deferrals and plan.deferrals[o.ref].reason != "EXCEEDS_EVERY_VEHICLE"]


# ============================================================ F9 live operations and offline sync
@dataclass
class Eta:
    ref: str
    outlet_id: str
    eta: float
    close: int
    risk: bool       # K7: ETA > close - risk margin
    late: bool


def reschedule_remaining(stops: list, done: list, now: float, ctx: DayContext) -> list:
    """K6: EXPECTED times for the remaining stops from the last actual time (no depot delay).
    stops in driving order; done = [(actual arrive, actual leave)] of completed stops; now = actual departure if none done."""
    t = done[-1][1] if done else now
    etas = []
    for k, o in enumerate(stops[len(done):], start=len(done)):
        arrive = t + leg_minutes(o.district, k == 0, t, ctx, EXPECTED)
        etas.append(Eta(o.ref, o.outlet_id, arrive, o.close, arrive > o.close - P.RISK_MARGIN_MIN, arrive > o.close))
        t = max(arrive, o.open) + service_minutes(o, ctx, EXPECTED)
    return etas


def not_departed(planned_departure: float, now: float, departed: bool) -> bool:
    """K10 (P22): fires once 15 minutes have passed since the planned departure."""
    return not departed and now >= planned_departure + P.NOT_DEPARTED_AFTER_MIN


def long_stop_alarm_time(order: Order, arrive: float, ctx: DayContext) -> float:
    """K11 (P23): the service clock starts at the later of arrival and window open."""
    return max(arrive, order.open) + service_minutes(order, ctx, EXPECTED) + P.LONG_STOP_EXTRA_MIN


def project_position(stops: list, done: list, now: float, ctx: DayContext):
    """K12 dead reckoning while a vehicle is silent: probable position + ETAs from the last known fact."""
    etas = reschedule_remaining(stops, done, now, ctx)
    for e, o in zip(etas, stops[len(done):]):
        if now < e.eta:
            return f"driving to {o.outlet_id}", etas
        if now < max(e.eta, o.open) + service_minutes(o, ctx, EXPECTED):
            return f"at {o.outlet_id}", etas
    return "returning to depot", etas


def sync_event(applied: set, plan_version: dict, event: dict) -> str:
    """Q1-Q6. event = {uuid, stop, base_version}; plan_version = stop -> current version."""
    if event["uuid"] in applied:
        return "IGNORE_DUPLICATE"                                                                # Q2
    applied.add(event["uuid"])                                                                   # Q3
    if plan_version.get(event["stop"], event["base_version"]) != event["base_version"]:          # Q4
        return "APPLY_FACT_KEEP_RECORDED_TIME + RAISE_CONFLICT"                                  # Q6
    return "APPLY_FACT_KEEP_RECORDED_TIME"                                                       # Q5

