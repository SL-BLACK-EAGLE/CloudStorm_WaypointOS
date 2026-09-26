/**
 * Seeds Postgres from the organisers' CSVs:
 *   reference data -> catalogue -> order history + the 23 Dec demo day -> fleet status
 *   -> weekly fuel used -> baseline forecast -> demo clock -> demo users (Clerk).
 *
 *   pnpm db:seed              full seed (reference + operations + users)
 *   pnpm db:seed --ops-only   reset operational data only (used by the /demo panel's reset)
 */
import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { closeDb, createDb, type Database } from "../client";
import * as s from "../schema";
import { buildCatalog } from "./catalog";
import { int, num, orNull, readCsv, type Row } from "./csv";
import { DEMO_CLOCK_START, DEMO_RUN_DATE, DEPOTS, HISTORY_FROM, WALKTHROUGH_OUTLET, WORKSHOP } from "./scenario";
import { seedUsers } from "./users";

config({ path: "../../.env" });

const hhmm = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const dayDiff = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000);

async function insertChunked<T extends Record<string, unknown>>(db: Database, table: Parameters<Database["insert"]>[0], rows: T[], size = 1000) {
  for (let i = 0; i < rows.length; i += size) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.insert(table).values(rows.slice(i, i + size) as any);
  }
}

// ─────────────────────────────────────────────────────────────── reference
export async function seedReference(db: Database) {
  await db.execute(sql`truncate table depots, districts, outlets, vehicles, service_allowances, calendar_days,
    traffic_speed, road_conditions, products restart identity cascade`);
  await db.insert(s.depots).values(DEPOTS);

  const dt = readCsv("General Data", "district_travel.csv");
  await db.insert(s.districts).values(
    dt.map((r) => ({
      name: r.district!,
      depotId: r.depot!,
      roadClass: r.road_class!,
      freeFlowKmh: num(r.free_flow_kmh),
      depotKm: num(r.depot_to_district_km),
      outboundMin: int(r.depot_to_district_freeflow_min),
      interStopKm: num(r.inter_stop_km),
      interStopMin: int(r.inter_stop_freeflow_min),
    })),
  );

  const ol = readCsv("General Data", "outlets.csv");
  const ordinal = new Map<string, number>();
  await db.insert(s.outlets).values(
    ol.map((r) => {
      const key = `${r.brand}|${r.district}`;
      const n = (ordinal.get(key) ?? 0) + 1;
      ordinal.set(key, n);
      return {
        id: r.outlet_id!,
        name: `Waypoint ${r.brand} ${r.district} ${n}`,
        brand: r.brand as "Fresh",
        district: r.district!,
        depotId: r.depot!,
        dockType: r.dock_type as "street",
        parking: r.parking_constraint as "normal",
        mallWindow: orNull(r.mall_window),
        windowOpen: hhmm(r.window_open_time!),
        windowClose: hhmm(r.window_close_time!),
      };
    }),
  );

  await db.insert(s.vehicles).values(
    readCsv("General Data", "vehicles.csv").map((r) => ({
      id: r.vehicle_id!,
      type: r.type as "truck",
      temp: r.temp as "reefer",
      weightCapKg: num(r.weight_cap_kg),
      volumeCapM3: num(r.volume_cap_m3),
      fuelType: r.fuel_type!,
      kmPerL: num(r.km_per_l),
      weeklyFuelQuotaL: num(r.weekly_fuel_quota_l),
      depotId: r.depot!,
    })),
  );

  await db.insert(s.serviceAllowances).values(
    readCsv("General Data", "service_allowance.csv").map((r) => ({
      brand: r.brand as "Fresh",
      dockType: r.dock_type as "street",
      minutes: int(r.service_allowance_min),
    })),
  );

  await insertChunked(
    db,
    s.calendarDays,
    readCsv("General Data", "calendar.csv").map((r) => ({
      date: r.date!,
      dow: int(r.dow),
      dowName: r.dow_name!,
      isWeekend: int(r.is_weekend),
      isoYear: int(r.iso_year),
      isoWeek: int(r.iso_week),
      isPayday: int(r.is_payday),
      festival: orNull(r.festival),
      festivalRamp: num(r.festival_ramp),
      isHoliday: int(r.is_holiday),
      monsoon: int(r.monsoon),
      isOperating: int(r.is_operating),
    })),
  );

  await insertChunked(
    db,
    s.trafficSpeed,
    readCsv("General Data", "traffic_speed.csv").map((r) => ({
      district: r.district!,
      hour: int(r.hour),
      monsoon: int(r.monsoon),
      speedIndex: num(r.speed_index),
    })),
  );

  await insertChunked(
    db,
    s.roadConditions,
    readCsv("General Data", "road_conditions.csv").map((r) => ({
      district: r.district!,
      date: r.date!,
      disruptionIndex: num(r.disruption_index),
    })),
    2000,
  );
  console.log(`  reference: ${ol.length} outlets, ${dt.length} districts, fleet, calendar, traffic, road conditions`);
}

// ─────────────────────────────────────────────────────────────── operations
export async function seedOperations(db: Database) {
  await db.execute(sql`truncate table orders, order_lines, plans, trips, trip_stops, deferrals, load_checks, shortfalls,
    dock_signoffs, pods, stop_exceptions, receipts, receipt_issues, messages, notifications, fuel_ledger, forecasts,
    sync_events, conflicts, audit_log, outbox, vehicle_days, app_settings, products restart identity cascade`);

  const deliveries = readCsv("Training Data", "deliveries_train.csv");
  const legs = readCsv("Training Data", "route_legs_train.csv");
  const calendar = new Map(readCsv("General Data", "calendar.csv").map((r) => [r.date!, r]));
  const vehicles = new Map(readCsv("General Data", "vehicles.csv").map((r) => [r.vehicle_id!, r]));
  const districtKm = new Map(readCsv("General Data", "district_travel.csv").map((r) => [r.district!, num(r.depot_to_district_km)]));

  // catalogue calibrated to the dataset's mean unit weight and volume
  const acc = new Map<string, { kg: number; m3: number; units: number }>();
  for (const r of deliveries) {
    const k = `${r.brand}|${r.temp_requirement}`;
    const a = acc.get(k) ?? { kg: 0, m3: 0, units: 0 };
    a.kg += num(r.order_weight_kg);
    a.m3 += num(r.order_volume_m3);
    a.units += int(r.order_units);
    acc.set(k, a);
  }
  const means = new Map([...acc].map(([k, a]) => [k, { kg: a.kg / a.units, m3: a.m3 / a.units }]));
  const catalog = buildCatalog(means);
  await db.insert(s.products).values(catalog);

  // fairness counters for the demo day, computed exactly like the Python oracle (datasets.day_orders)
  const isOperating = (d: string) => calendar.get(d)?.is_operating === "1";
  const prevOperating = (d: string) => {
    let x = new Date(`${d}T00:00:00Z`);
    do x = new Date(x.getTime() - 86_400_000);
    while (!isOperating(x.toISOString().slice(0, 10)));
    return x.toISOString().slice(0, 10);
  };
  const prev = prevOperating(DEMO_RUN_DATE);
  const skipped = new Set(deliveries.filter((r) => r.order_date === prev && r.dispatch_status !== "attempted").map((r) => r.outlet_id));
  const lastServed = new Map<string, string>();
  for (const r of deliveries) {
    const d = r.dispatch_date;
    if (d && d < DEMO_RUN_DATE && (lastServed.get(r.outlet_id!) ?? "") < d) lastServed.set(r.outlet_id!, d);
  }

  const toOrder = (r: Row) => {
    const historic = r.order_date! < DEMO_RUN_DATE;
    const status: "confirmed" | "cancelled" | "delivered" = !historic
      ? "confirmed"
      : r.dispatch_status === "not_run"
        ? "cancelled"
        : "delivered";
    const last = lastServed.get(r.outlet_id!);
    return {
      id: r.delivery_id!,
      outletId: r.outlet_id!,
      brand: r.brand as "Fresh",
      depotId: r.depot!,
      temp: r.temp_requirement as "ambient",
      requestedDate: r.order_date!,
      runDate: historic && r.dispatch_date ? r.dispatch_date : r.order_date!,
      status,
      intakeReason: "ON_TIME",
      units: int(r.order_units),
      weightKg: num(r.order_weight_kg),
      volumeM3: num(r.order_volume_m3),
      deferredYesterday: historic ? 0 : skipped.has(r.outlet_id) ? 1 : 0,
      daysSinceLastServed: historic ? 1 : Math.max(last ? dayDiff(DEMO_RUN_DATE, last) : 7, 1),
      deferCount: r.dispatch_status === "deferred" ? 1 : 0,
      source: "dataset",
      note: r.dispatch_status === "not_run" ? "Never dispatched (dataset: not_run)" : null,
      receivedAt: new Date(`${prevOperating(r.order_date!)}T10:00:00+05:30`),
    };
  };
  const window = deliveries.filter(
    (r) =>
      r.order_date! >= HISTORY_FROM &&
      r.order_date! <= DEMO_RUN_DATE &&
      !(r.order_date === DEMO_RUN_DATE && r.outlet_id === WALKTHROUGH_OUTLET),
  );
  const orderRows = window.map(toOrder);
  await insertChunked(db, s.orders, orderRows, 500);
  await insertChunked(
    db,
    s.receipts,
    orderRows
      .filter((o) => o.status === "delivered")
      .map((o) => ({ orderId: o.id, status: "confirmed" as const, unitsReceived: o.units, confirmedAt: new Date(`${o.runDate}T08:30:00+05:30`) })),
    500,
  );
  const today = orderRows.filter((o) => o.requestedDate === DEMO_RUN_DATE);
  console.log(`  orders: ${orderRows.length} (${today.length} for ${DEMO_RUN_DATE}; ${WALKTHROUGH_OUTLET} left for the walkthrough)`);

  // fleet status on the demo day
  await db.insert(s.vehicleDays).values(
    [...vehicles.keys()].map((id) => ({
      vehicleId: id,
      date: DEMO_RUN_DATE,
      status: (WORKSHOP[id] ? "in_workshop" : "available") as "available",
      note: WORKSHOP[id] ?? null,
    })),
  );

  // litres each vehicle burned earlier in the demo day's ISO week (route legs + return leg)
  const c = calendar.get(DEMO_RUN_DATE)!;
  const week = new Set([...calendar.values()].filter((r) => r.iso_year === c.iso_year && r.iso_week === c.iso_week && r.date! < DEMO_RUN_DATE).map((r) => r.date));
  const routeKm = new Map<string, { vehicle: string; district: string; km: number }>();
  for (const l of legs) {
    if (!week.has(l.date)) continue;
    const r = routeKm.get(l.route_id!) ?? { vehicle: l.vehicle_id!, district: l.district!, km: 0 };
    r.km += num(l.distance_km);
    routeKm.set(l.route_id!, r);
  }
  const litres = new Map<string, number>();
  for (const r of routeKm.values()) {
    const l = (r.km + districtKm.get(r.district)!) / num(vehicles.get(r.vehicle)!.km_per_l);
    litres.set(r.vehicle, (litres.get(r.vehicle) ?? 0) + l);
  }
  if (litres.size) {
    await db.insert(s.fuelLedger).values(
      [...litres].map(([vehicleId, l]) => ({ vehicleId, isoYear: int(c.iso_year), isoWeek: int(c.iso_week), litresUsed: l })),
    );
  }

  // baseline forecast: seasonal naive (same ISO week last year) x recent year-on-year growth
  const weekly = new Map<string, { total: number; chilled: number }>();
  for (const r of deliveries) {
    const cal = calendar.get(r.order_date!)!;
    const key = `${r.depot}|${r.brand}|${cal.iso_year}|${cal.iso_week}`;
    const w = weekly.get(key) ?? { total: 0, chilled: 0 };
    w.total += num(r.order_volume_m3);
    if (r.temp_requirement === "chilled") w.chilled += num(r.order_volume_m3);
    weekly.set(key, w);
  }
  const forecastRows = [];
  for (const depot of ["Peliyagoda", "Kandy"]) {
    for (const brand of ["Fresh", "Style", "Tech"] as const) {
      const sumWeeks = (year: number, from: number, to: number) => {
        let t = 0;
        for (let w = from; w <= to; w++) t += weekly.get(`${depot}|${brand}|${year}|${w}`)?.total ?? 0;
        return t;
      };
      const growth = sumWeeks(2025, 40, 51) / Math.max(sumWeeks(2024, 40, 51), 1e-9);
      for (let w = 1; w <= 10; w++) {
        const base = weekly.get(`${depot}|${brand}|2025|${w}`) ?? { total: 0, chilled: 0 };
        forecastRows.push({
          depotId: depot,
          brand,
          isoYear: 2026,
          isoWeek: w,
          totalM3: base.total * growth,
          chilledM3: brand === "Fresh" ? base.chilled * growth : 0,
          source: "baseline",
        });
      }
    }
  }
  await db.insert(s.forecasts).values(forecastRows);

  await db.insert(s.appSettings).values([
    { key: "clock", value: { at: DEMO_CLOCK_START, running: false, anchorReal: Date.now(), speed: 1 } },
    { key: "demo", value: { runDate: DEMO_RUN_DATE, walkthroughOutlet: WALKTHROUGH_OUTLET } },
    { key: "planner", value: { reloadMin: 30, riskMarginMin: 20 } },
  ]);
  console.log(`  fleet: ${Object.keys(WORKSHOP).length} in workshop; fuel ledger for ${litres.size} vehicles; ${forecastRows.length} forecast rows`);
}

async function main() {
  const opsOnly = process.argv.includes("--ops-only");
  const db = createDb();
  const t = Date.now();
  if (!opsOnly) {
    console.log("seeding reference data…");
    await seedReference(db);
  }
  console.log("seeding operations…");
  await seedOperations(db);
  console.log("seeding demo users…");
  await seedUsers(db);
  console.log(`done in ${((Date.now() - t) / 1000).toFixed(1)} s`);
  await closeDb(db);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("seed/index.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
