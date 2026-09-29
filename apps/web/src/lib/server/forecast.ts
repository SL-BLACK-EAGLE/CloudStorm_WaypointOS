import "server-only";
import { and, asc, avg, eq } from "@waypoint/db/orm";
import { db, t } from "./db";
import { audit } from "./events";
import { publishedPlan, type DepotId } from "./planning";
import { reference } from "./reference";
import { runs } from "./runs";

const BRANDS = ["Fresh", "Style", "Tech"] as const;
const DEPOTS = ["Kandy", "Peliyagoda"] as const;
type Brand = (typeof BRANDS)[number];

/** Chilled orders one reefer trip carried on the reference day (booklet sample, 23 Dec) - used until a plan of our own exists. */
const SAMPLE_CHILLED_PER_REEFER_TRIP = 3.1;
const TRIPS_PER_VEHICLE_DAY = 2;
const OPERATING_DAYS = 6;
const FRESH_BUDGET_MIN = 270;

export interface ForecastWeek {
  isoYear: number;
  isoWeek: number;
  total: Record<Brand, number>;
  chilled: number;
}

/** D-07: demand forecast (Datathon upload or the seeded baseline), supply from the fleet, and the reefer gap per week. */
export async function forecastView(depot: DepotId, preferred?: "datathon" | "baseline") {
  const R = await reference();
  const rows = await db()
    .select()
    .from(t.forecasts)
    .where(eq(t.forecasts.depotId, depot))
    .orderBy(asc(t.forecasts.isoYear), asc(t.forecasts.isoWeek));
  const sources = [...new Set(rows.map((r) => r.source))] as Array<"datathon" | "baseline">;
  const source = preferred && sources.includes(preferred) ? preferred : sources.includes("datathon") ? "datathon" : (sources[0] ?? null);
  const weeks = new Map<string, ForecastWeek>();
  for (const r of rows.filter((x) => x.source === source)) {
    const key = `${r.isoYear}-${r.isoWeek}`;
    const w = weeks.get(key) ?? { isoYear: r.isoYear, isoWeek: r.isoWeek, total: { Fresh: 0, Style: 0, Tech: 0 }, chilled: 0 };
    w.total[r.brand as Brand] = r.totalM3;
    w.chilled += r.chilledM3;
    weeks.set(key, w);
  }
  const uploadedAt = rows.filter((x) => x.source === source).reduce<Date | null>((a, r) => (!a || r.uploadedAt > a ? r.uploadedAt : a), null);

  // supply straight from the fleet table
  const fleet = [...R.vehicles.values()].filter((v) => v.depot === depot);
  const reefers = fleet.filter((v) => v.temp === "reefer");
  const vans = fleet.filter((v) => v.type === "van");
  const quota = fleet.reduce((n, v) => n + v.weeklyQuotaL, 0);
  const otherQuota = [...R.vehicles.values()].filter((v) => v.depot !== depot).reduce((n, v) => n + v.weeklyQuotaL, 0);

  // conversion: m³ of chilled demand → chilled orders → reefer trips
  const [{ m3 } = { m3: null }] = await db()
    .select({ m3: avg(t.orders.volumeM3) })
    .from(t.orders)
    .where(and(eq(t.orders.depotId, depot), eq(t.orders.temp, "chilled")));
  const chilledOrderM3 = m3 ? Number(m3) : null;
  const perTrip = await chilledPerReeferTrip(depot);

  return {
    depot,
    source,
    sources,
    uploadedAt,
    weeks: [...weeks.values()],
    supply: {
      reefers: reefers.length,
      reeferTrucks: reefers.filter((v) => v.type === "truck").length,
      reeferVans: reefers.filter((v) => v.type === "van").length,
      reeferTripsPerWeek: reefers.length * TRIPS_PER_VEHICLE_DAY * OPERATING_DAYS,
      freshMinutes: reefers.length * FRESH_BUDGET_MIN * OPERATING_DAYS,
      vans: vans.length,
      reeferVansCount: vans.filter((v) => v.temp === "reefer").length,
      quota,
      otherQuota,
      fleet: fleet.length,
    },
    chilledOrderM3,
    perTrip,
    service: await observedService(depot),
  };
}

/** Chilled orders per reefer trip on the latest published plan of the depot (falls back to the booklet's reference day). */
async function chilledPerReeferTrip(depot: DepotId) {
  const { active, planning } = await runs();
  const plan = (await publishedPlan(depot, active)) ?? (await publishedPlan(depot, planning));
  if (!plan) return { value: SAMPLE_CHILLED_PER_REEFER_TRIP, basis: "sample" as const, runDate: null, trips: 0, orders: 0 };
  const rows = await db()
    .select({ tripId: t.trips.id, temp: t.orders.temp, vehicleTemp: t.vehicles.temp })
    .from(t.trips)
    .innerJoin(t.vehicles, eq(t.vehicles.id, t.trips.vehicleId))
    .innerJoin(t.tripStops, eq(t.tripStops.tripId, t.trips.id))
    .innerJoin(t.orders, eq(t.orders.id, t.tripStops.orderId))
    .where(and(eq(t.trips.planId, plan.id), eq(t.vehicles.temp, "reefer")));
  const trips = new Set(rows.map((r) => r.tripId)).size;
  const orders = rows.filter((r) => r.temp === "chilled").length;
  if (!trips || !orders) return { value: SAMPLE_CHILLED_PER_REEFER_TRIP, basis: "sample" as const, runDate: plan.runDate, trips, orders };
  return { value: Math.round((orders / trips) * 10) / 10, basis: "plan" as const, runDate: plan.runDate, trips, orders };
}

/** Observed service time on the latest delivered stops = left − later of arrival and window open, against the flat allowance. */
async function observedService(depot: DepotId) {
  const { active, planning } = await runs();
  const plan = (await publishedPlan(depot, active)) ?? (await publishedPlan(depot, planning));
  if (!plan) return [];
  const rows = await db()
    .select({
      outletId: t.orders.outletId,
      units: t.orders.units,
      brand: t.orders.brand,
      dock: t.outlets.dockType,
      open: t.outlets.windowOpen,
      arrived: t.tripStops.arrivedMin,
      left: t.tripStops.leftMin,
      code: t.trips.code,
    })
    .from(t.tripStops)
    .innerJoin(t.trips, eq(t.trips.id, t.tripStops.tripId))
    .innerJoin(t.orders, eq(t.orders.id, t.tripStops.orderId))
    .innerJoin(t.outlets, eq(t.outlets.id, t.orders.outletId))
    .where(and(eq(t.trips.planId, plan.id), eq(t.tripStops.status, "delivered")));
  const allowances = await db().select().from(t.serviceAllowances);
  const allow = new Map(allowances.map((a) => [`${a.brand}|${a.dockType}`, a.minutes]));
  return rows
    .filter((r) => r.arrived !== null && r.left !== null)
    .map((r) => {
      const observed = Math.round(r.left! - Math.max(r.arrived!, r.open));
      const allowance = allow.get(`${r.brand}|${r.dock}`) ?? 15;
      return { ...r, observed, allowance, ratio: observed / allowance };
    })
    .filter((r) => r.observed > 0)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 6);
}

/**
 * Loads a Task 2A forecast. Accepts the filled submission file (row_id, pred_total_volume_m3, pred_chilled_volume_m3,
 * where row_id W0000..W0059 = week 14..23 × {Kandy, Peliyagoda} × {Fresh, Style, Tech}) or a long file with
 * depot, brand, iso_year, iso_week, pred_total_volume_m3, pred_chilled_volume_m3. Enforces the Datathon's hard rules.
 */
export async function uploadForecast(csv: string, userId: string) {
  const lines = csv.replace(/^﻿/, "").trim().split(/\r?\n/);
  const header = lines[0]!.split(",").map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const total = col("pred_total_volume_m3");
  const chilled = col("pred_chilled_volume_m3");
  if (total < 0 || chilled < 0) throw new Error("Expected columns pred_total_volume_m3 and pred_chilled_volume_m3");
  const out: Array<{ depotId: string; brand: Brand; isoYear: number; isoWeek: number; totalM3: number; chilledM3: number }> = [];
  for (const [i, line] of lines.slice(1).entries()) {
    if (!line.trim()) continue;
    const c = line.split(",").map((x) => x.trim());
    let depot: string, brand: string, year: number, week: number;
    if (col("row_id") >= 0) {
      const m = /^W(\d{4})$/.exec(c[col("row_id")] ?? "");
      if (!m) throw new Error(`Row ${i + 2}: row_id must look like W0000`);
      const n = Number(m[1]);
      if (n > 59) throw new Error(`Row ${i + 2}: row_id ${c[col("row_id")]} is outside W0000-W0059`);
      week = 14 + Math.floor(n / 6);
      depot = DEPOTS[Math.floor((n % 6) / 3)]!;
      brand = BRANDS[n % 3]!;
      year = 2026;
    } else {
      depot = c[col("depot")] ?? "";
      brand = c[col("brand")] ?? "";
      year = Number(c[col("iso_year")]);
      week = Number(c[col("iso_week")]);
    }
    if (!DEPOTS.includes(depot as never) || !BRANDS.includes(brand as never) || !Number.isInteger(year) || !(week >= 1 && week <= 53))
      throw new Error(`Row ${i + 2}: unknown depot, brand or week`);
    const tv = Number(c[total]);
    const cv = Number(c[chilled]);
    if (!Number.isFinite(tv) || !Number.isFinite(cv)) throw new Error(`Row ${i + 2}: volumes must be numbers`);
    if (tv < 0 || cv < 0) throw new Error(`Row ${i + 2}: volumes cannot be negative`);
    if (cv > tv + 1e-9) throw new Error(`Row ${i + 2}: chilled volume is larger than the total`);
    if (brand !== "Fresh" && cv > 0) throw new Error(`Row ${i + 2}: ${brand} has no chilled goods - chilled must be 0`);
    out.push({ depotId: depot, brand: brand as Brand, isoYear: year, isoWeek: week, totalM3: tv, chilledM3: cv });
  }
  if (!out.length) throw new Error("The file has no rows");
  const keys = new Set(out.map((r) => `${r.depotId}|${r.brand}|${r.isoYear}|${r.isoWeek}`));
  if (keys.size !== out.length) throw new Error("The file repeats a depot × brand × week");
  await db().transaction(async (tx) => {
    for (const r of out)
      await tx
        .insert(t.forecasts)
        .values({ ...r, source: "datathon", uploadedAt: new Date() })
        .onConflictDoUpdate({
          target: [t.forecasts.depotId, t.forecasts.brand, t.forecasts.isoYear, t.forecasts.isoWeek],
          set: { totalM3: r.totalM3, chilledM3: r.chilledM3, source: "datathon", uploadedAt: new Date() },
        });
    await audit(tx, { actorId: userId, action: "forecast.upload", entity: "forecast", entityId: "task2a", after: { rows: out.length } });
  });
  const weeks = [...new Set(out.map((r) => r.isoWeek))].sort((a, b) => a - b);
  return { rows: out.length, from: weeks[0]!, to: weeks[weeks.length - 1]! };
}


/** Removes an uploaded Datathon forecast; the seeded baseline stays. */
export async function clearDatathonForecast(userId: string) {
  await db().transaction(async (tx) => {
    const gone = await tx.delete(t.forecasts).where(eq(t.forecasts.source, "datathon")).returning({ w: t.forecasts.isoWeek });
    await audit(tx, { actorId: userId, action: "forecast.clear", entity: "forecast", entityId: "task2a", before: { rows: gone.length } });
  });
}
