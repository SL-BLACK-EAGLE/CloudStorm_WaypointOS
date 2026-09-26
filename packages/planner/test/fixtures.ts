/**
 * Loads the golden fixtures written by tools/planner-oracle/export_golden.py.
 * They are derived from the confidential dataset, so they live in the git-ignored
 * seed-data/golden folder; suites that need them are skipped when it is absent.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createReference, makeOrder, type Reference, type ReferenceInput } from "../src/reference";
import type { DayContext, Leg, Mode, Order, OrderInput } from "../src/types";

const here = dirname(fileURLToPath(import.meta.url));
export const GOLDEN_DIR = process.env.GOLDEN_DIR ?? resolve(here, "../../../seed-data/golden");
export const hasGolden = existsSync(join(GOLDEN_DIR, "reference.json"));

function load<T>(name: string): T {
  return JSON.parse(readFileSync(join(GOLDEN_DIR, name), "utf8")) as T;
}

let cachedRef: Reference | null = null;
export function reference(): Reference {
  cachedRef ??= createReference(load<ReferenceInput>("reference.json"));
  return cachedRef;
}

export interface GoldenPlan {
  name: string;
  mode: Mode;
  ctx: DayContext;
  status: Record<string, string>;
  fuelUsed: Record<string, number>;
  orders: OrderInput[];
  plan: {
    mode: Mode;
    trips: Record<string, string[][]>;
    deferrals: Record<string, { kind: string; reason: string; lostTo: string | null }>;
    timed: Array<{
      vehicleId: string;
      number: number;
      stops: string[];
      departure: number | null;
      tripMinutes: number;
      litres: number;
      planned: Leg[];
      backPlanned: number | null;
      expected: Leg[];
      backExpected: number | null;
    }>;
  };
}

export const PLAN_NAMES = [
  "s1-2b",
  "s1-live",
  "2025-09-10-peliyagoda",
  "2025-09-10-kandy",
  "2025-12-23-peliyagoda",
  "2025-12-23-kandy",
  "2025-12-23-peliyagoda-veh036",
] as const;

export function goldenPlan(name: string): GoldenPlan {
  return load<GoldenPlan>(`plan-${name}.json`);
}

export interface GoldenRoutes {
  routes: Record<
    string,
    {
      date: string;
      ctx: DayContext;
      orders: OrderInput[];
      legs: Array<{ to_outlet: string; planned_depart_time: string; planned_arrival_time: string; arrival_time: string }>;
    }
  >;
  extras: { techOrder: OrderInput };
  worstDay: {
    date: string;
    ctx: DayContext;
    routes: Array<{ routeId: string; departure: string; orders: OrderInput[]; actualArrivals: string[]; expected: Leg[] }>;
  };
}

let cachedRoutes: GoldenRoutes | null = null;
export function routes(): GoldenRoutes {
  cachedRoutes ??= load<GoldenRoutes>("routes.json");
  return cachedRoutes;
}

export function orders(inputs: OrderInput[]): Order[] {
  const R = reference();
  return inputs.map((o) => makeOrder(R, o));
}

/** S1 orders keyed by ref, from the Task 2B golden plan. */
export function s1(): { byRef: Record<string, Order>; list: Order[]; status: Record<string, string>; ctx: DayContext } {
  const g = goldenPlan("s1-2b");
  const list = orders(g.orders);
  return { byRef: Object.fromEntries(list.map((o) => [o.ref, o])), list, status: g.status, ctx: g.ctx };
}
