# seed-data (git-ignored)

The competition datasets are confidential (Challenge Booklet p.22) and are **not committed**.

Put the organisers' dataset folder here so the tree looks like this:

```
seed-data/
  check_allocation.py
  data/
    General Data/      calendar.csv, district_travel.csv, outlets.csv, road_conditions.csv,
                       service_allowance.csv, traffic_speed.csv, vehicles.csv
    Training Data/     deliveries_train.csv, route_legs_train.csv
    Test Data/         task2b_peak_day_scenarios.csv, task2b_peak_day_fleet.csv, ...
    Submission Templates/
```

`docker compose up` mounts this folder into the `seed` service. The planner golden
fixtures (`seed-data/golden/`) are generated from it by `tools/planner-oracle/export_golden.py`.
