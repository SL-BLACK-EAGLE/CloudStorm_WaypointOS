"""Planning parameters P01-P23 (flowchart section 2).

Every value comes from the supplied dataset unless it is marked ASSUMPTION or POLICY.
Change a value here and the whole algorithm follows; the tests show what that changes.
"""

# P01, P02  earliest planned departures seen in route_legs_train.csv (minutes after midnight)
EARLIEST_DEPARTURE = {"Fresh": 2 * 60, "Style": 7 * 60 + 30, "Tech": 7 * 60 + 30}

# P03, P04  booklet rule 7; history: 18,777 Fresh vehicle-days, none above 270 (max exactly 270)
TIME_BUDGET = {"Fresh": 270, "Day": 480}  # "Day" = Style and Tech trips combined

# P05  booklet rule 7
MAX_TRIPS = 2

# P16  ASSUMPTION: dock turnaround between a vehicle's trips (history cannot show it:
#      recorded trip-2 departures overlap trip 1 by a median 73 minutes)
RELOAD_MIN = 30

# P12  mean(actual - planned first departure) = 7.7 min, p90 15, same for every brand and depot
DEPOT_DELAY_MIN = 8

# P13  actual travel = planned x 100/speed_index x 100/disruption_index x factor; factor = 1.000
TRAVEL_FACTOR = 1.00

# P15  flag late risk when expected arrival is within 20 min of window close
#      2026 hold-out: catches 85% of real late arrivals, precision 0.62 (margin 10: 78% / 0.71; 30: 89% / 0.54)
RISK_MARGIN_MIN = 20

# P18  booklet: orders close at 16:00 on the operating day before the run
CUTOFF_MIN = 16 * 60

# P14  expected service minutes = base[dock] + u*units + f*festival_ramp + p*payday + m*monsoon
#      least squares on 2024-01..2025-12, MAE 5.7 min vs 7.1 for the allowance table
SERVICE_MODEL = {
    "Fresh": {"base": {"rear_dock": 3.9, "street": 7.5, "mall_bay": 7.5}, "u": 0.178, "f": 13.9, "p": 5.1, "m": 3.1},
    "Style": {"base": {"rear_dock": -4.0, "street": 14.6, "mall_bay": 31.0}, "u": 0.724, "f": 43.8, "p": 14.2, "m": 7.7},
    "Tech": {"base": {"rear_dock": 5.7, "street": 22.7, "mall_bay": 34.0}, "u": 7.605, "f": 43.2, "p": 16.7, "m": 6.9},
}
MIN_SERVICE_MIN = 3

# P19  POLICY: no repeat deferral >> days unserved >> perishable >> volume
WEIGHT_DEFERRED_YESTERDAY = 1000
WEIGHT_PER_DAY_UNSERVED = 20
WEIGHT_CHILLED = 10
WEIGHT_PER_M3 = 1

# P20  scarcest resource first
CLASS_NAMES = ("van-only chilled", "chilled", "van-only ambient", "everything else")

# P21  never spend a reefer or a van on what a plain truck can carry
CAPABILITY_COST = {"reefer": 2, "van": 1}

# P22  p90 of depot departure delay
NOT_DEPARTED_AFTER_MIN = 15

# P23  p90 of (actual - expected service) = 9.7 min
LONG_STOP_EXTRA_MIN = 10

# pull-back attempts in F7 (flowchart node H6)
DEPARTURE_PULLBACK_ATTEMPTS = 3
