# Delivery planning algorithm

This folder contains the Python version of `docs/Delivery_Planning_Flowchart.md`. It turns confirmed orders into vehicle trips, timed route legs, explained deferrals and live ETAs, using the rules in the challenge booklet and parameters taken from the dataset.

It runs in two modes:
- **2B** applies the booklet rules only. Its S1 output passes the organisers' `check_allocation.py`.
- **LIVE** adds clock-time delivery windows, trip-2 timing, weekly fuel quotas and late-risk flags, for the Hackathon system.

## Files

| File | What it holds |
|---|---|
| `algorithm.py` | The complete algorithm, one section per flowchart chart (M, F1–F9); comments carry the node IDs |
| `params.py` | Parameters P01–P23 with the data evidence for each value |
| `reference.py` | Reference CSVs loaded into lookups (outlets, vehicles, districts, allowances, calendar, traffic, road conditions) |
| `datasets.py` | Builds inputs from the dataset: S1, any historical day and depot, recorded routes; Task 2B export and checker |
| `run.py` | Simulation command line |
| `tests/test_cases.py` | Flowchart test cases TC-01 to TC-38 |
| `tests/test_scenarios.py` | Full-day simulations SC-1 to SC-5 on real dates |
| `tests/test_validation.py` | The algorithm checked against the dataset as it is (V1–V4, V7, V8) |

## Flowchart to code

| Chart | Function |
|---|---|
| M master flow | `plan_day()`, `time_plan()`, `load_list()`, `dock_signoff()`, `carry_over()` |
| F1 intake and cutoff | `intake()`, `next_operating_day()`, `previous_operating_day()` |
| F2 eligibility | `check_vehicle()`, `eligible_vehicles()`, `unavoidable_reason()` |
| F3 weight and class | `weight()`, `order_class()` |
| F4 trip construction | `build_trips()` |
| F5 vehicle-day check | `check_vehicle_day()` |
| F6 route-leg scheduling | `schedule()`, `sequence()`, `leg_minutes()`, `service_minutes()` |
| F7 departure time | `departure_time()` |
| F8 repair and classify | `repair_and_classify()` |
| F9 live and sync | `reschedule_remaining()`, `not_departed()`, `long_stop_alarm_time()`, `project_position()`, `sync_event()` |

## Set up the environment

The code needs Python 3.10+, pandas, numpy and pytest. It reads the data from `../datasets/data`. To use a copy elsewhere, set `WAYPOINT_DATA_DIR`.

```bash
cd delivery_planning_algorithm

# any machine
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# or reuse an Anaconda install without downloading anything
/opt/anaconda3/bin/python -m venv --system-site-packages .venv
source .venv/bin/activate
```

## Run the tests

```bash
pytest                                   # all 50 tests, about 20 seconds
pytest tests/test_cases.py               # the 38 flowchart test cases only
pytest -k tc25 -v                        # one case, e.g. the trip-2 clock rule
```

## Run simulations

```bash
python run.py s1                          # Task 2B plan -> output/submission_task2b.csv + official checker
python run.py s1 --mode LIVE --legs       # same day with clock-time windows and leg timetables
python run.py day 2025-12-23 Peliyagoda --legs
python run.py day 2025-12-23 Peliyagoda --workshop VEH036
python run.py replay R023442              # live ETAs after every recorded event of a real route
python run.py intake OUT006 ambient 601.7 3.428 2025-12-23 2025-12-22 16:05
```

## The algorithm in brief

1. **Intake (F1).**
   - Reject orders that are chilled for Style or Tech, or bigger than any vehicle that could serve the outlet.
   - Move an order to the next operating day if its requested day is closed or it arrived after the 16:00 cutoff.
2. **Eligibility (F2).** Check every order against every vehicle in its depot, in a fixed order: available, depot, reefer, van, weight, volume, time budget. An order with no eligible vehicle is deferred as UNAVOIDABLE, with a reason.
3. **Priority (F3).**
   - Weight = 1000 × deferred yesterday + 20 × days since last served + 10 × chilled + m³.
   - Class: van-only chilled, then chilled, then van-only ambient, then everything else.
4. **Trip construction (F4).**
   - Classes are handled scarcest first.
   - Each step considers every vehicle with a free trip and every brand + district bucket. It packs the bucket's orders by weight as long as F5 passes, scores the trip as weight per budget minute, and commits the best one.
   - Ties go to the least capable vehicle, then the one left with the fewest spare minutes, then the smaller vehicle, then the lower ID.
5. **Vehicle-day check (F5).**
   - Rules 1–7 are checked in a fixed order.
   - In LIVE mode, the weekly fuel quota and the clock follow: trips are ordered and each departure is chosen by F7. Trip 2 leaves when trip 1 is back plus a 30-minute reload, and every stop must arrive by its window close.
6. **Leg scheduling (F6).**
   - Stops are ordered by window close.
   - Travel uses the booklet's district minutes. In EXPECTED mode they are scaled by traffic and road disruption, with an 8-minute depot delay.
   - A vehicle that arrives early waits for the window. Service time is the allowance table (PLANNED) or the fitted formula (EXPECTED).
7. **Departure (F7).** Leave so the first stop is reached as it opens. Leave earlier only when an expected arrival would fall within 20 minutes of a window close.
8. **Repair and classify (F8).**
   - Each leftover order tries a legal slot, then a new trip, then a swap with a lighter order.
   - What remains is labelled CHOSEN (lost to a heavier order) or CAPACITY_FORCED (with the binding rule).
9. **Live (F9).**
   - ETAs are re-computed from each recorded event.
   - Alarms: not departed after planned + 15 min; long stop after expected service + 10 min.
   - A silent vehicle's position is estimated from the last known fact.
   - Offline events apply at their recorded time: duplicates are ignored and stale plan changes raise a conflict.

## Results (checked by the tests)

**S1 peak day**

| Mode | Served | Chilled served | Official checker |
|---|---|---|---|
| 2B | 77 / 85 | 19 / 26 | passes |
| LIVE | 74 / 85 | 16 / 26 | – |

**Real dates**

| Day | Result |
|---|---|
| 23 Dec 2025, Peliyagoda | 89 / 90 served; history deferred 11 |
| 10 Sep 2025 (normal day) | every order served at both depots |
| 15 Mar 2025 (worst day in history) | EXPECTED-mode flags the evening before catch 64 of 70 late stops |

**Against the dataset as it is**
- The booklet rules accept all 25,198 historical routes.
- The planned-time formula reproduces all 91,894 planned legs.
- On the 2026 hold-out, EXPECTED arrivals are off by 19.3 min on average, versus 38.7 for the dataset's own plan. The late-risk flag catches 85% of real late arrivals; the dataset's plan catches 4%.

## Known limits

- **Reload time (`RELOAD_MIN`, 30 min) is an assumption.** Calibrate it from loader sign-off times.
- **Travel uses district constants.** Real leg distances vary around them.
- **The EXPECTED service formula is a simple linear fit** (MAE 5.7 min). A Datathon model can replace `service_minutes()` without changing anything else.
