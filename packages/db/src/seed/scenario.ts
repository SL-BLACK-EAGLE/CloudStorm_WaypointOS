/**
 * The seeded demo: Tue 23 Dec 2025, the run-up to Christmas (festival ramp 0.8).
 *
 * Three Peliyagoda vehicles are in the workshop - reefer truck VEH001 and both reefer
 * vans - so demand exceeds capacity and the plan shows all three deferral classes:
 * UNAVOIDABLE (no reefer van for van-only chilled outlets), CAPACITY_FORCED (the 270-min
 * Fresh window) and CHOSEN (lost to a higher-priority order). Kandy runs its full fleet.
 */
export const DEMO_RUN_DATE = "2025-12-23";
/** Order history loaded for the store-manager views and fairness counters. */
export const HISTORY_FROM = "2025-12-15";
/** The judge places this outlet's two orders in step 1 of the walkthrough (design SM-02). */
export const WALKTHROUGH_OUTLET = "OUT006";
export const WORKSHOP: Record<string, string> = {
  VEH001: "Compressor fault on the refrigeration unit - back Thu 25 Dec",
  VEH035: "Scheduled service (reefer van)",
  VEH036: "Tyre replacement after puncture on the Kelani bridge",
};
/** The demo clock opens 90 minutes before the cutoff on the day before the run. */
export const DEMO_CLOCK_START = "2025-12-22T14:30:00";

export const DEPOTS = [
  { id: "Peliyagoda", name: "Peliyagoda Distribution Center", kind: "distribution_center" },
  { id: "Kandy", name: "Kandy Regional Hub", kind: "regional_hub" },
];

/** Demo accounts, one per role (booklet: four seeded accounts). */
export const DEMO_USERS = [
  { role: "dispatcher", name: "Nirmala Perera", email: "dispatcher+clerk_test@waypoint-demo.lk", depotId: null, outletId: null, vehicleId: null },
  { role: "loader", name: "Suresh Kumar", email: "loader+clerk_test@waypoint-demo.lk", depotId: "Peliyagoda", outletId: null, vehicleId: null },
  { role: "driver", name: "Ruwan Bandara", email: "driver+clerk_test@waypoint-demo.lk", depotId: "Peliyagoda", outletId: null, vehicleId: "VEH034" },
  { role: "store_manager", name: "Fathima Rizwan", email: "store+clerk_test@waypoint-demo.lk", depotId: "Peliyagoda", outletId: "OUT006", vehicleId: null },
] as const;

export const DEMO_PASSWORD = "Waypoint-Demo-2026";
