/**
 * Reference data (outlets, vehicles, districts, allowances, calendar, traffic) as fast lookups.
 *
 * The Python oracle loads these from CSV at import time. Here they are injected, so the
 * same engine runs in the browser (drag-and-drop validation), on the server (auto-plan)
 * and in tests (golden fixtures). The web app builds a Reference from Postgres.
 */
import { CAPABILITY_COST } from "./params";
import type { Brand, CalendarDay, District, Dock, Order, OrderInput, Outlet, Vehicle } from "./types";

export interface ReferenceInput {
  outlets: Outlet[];
  vehicles: Vehicle[];
  districts: District[];
  allowance: Array<{ brand: Brand; dock: Dock; minutes: number }>;
  speed: Array<{ district: string; hour: number; monsoon: number; index: number }>;
  calendar?: CalendarDay[];
}

export interface Reference {
  outlets: Map<string, Outlet>;
  vehicles: Map<string, Vehicle>;
  /** vehicle ids sorted ascending (Python `sorted(VEHICLES)`) */
  vehicleIds: string[];
  districts: Map<string, District>;
  allowance: (brand: Brand, dock: Dock) => number;
  speed: (district: string, hour: number, monsoon: number) => number;
  calendar: Map<string, CalendarDay>;
}

export function createReference(input: ReferenceInput): Reference {
  const outlets = new Map(input.outlets.map((o) => [o.id, o]));
  const vehicles = new Map(input.vehicles.map((v) => [v.id, v]));
  const districts = new Map(input.districts.map((d) => [d.name, d]));
  const allowance = new Map(input.allowance.map((a) => [`${a.brand}|${a.dock}`, a.minutes]));
  const speed = new Map(input.speed.map((s) => [`${s.district}|${s.hour}|${s.monsoon}`, s.index]));
  const calendar = new Map((input.calendar ?? []).map((c) => [c.date, c]));
  return {
    outlets,
    vehicles,
    vehicleIds: [...vehicles.keys()].sort(cmpStr),
    districts,
    allowance: (brand, dock) => must(allowance.get(`${brand}|${dock}`), `allowance ${brand}/${dock}`),
    speed: (district, hour, monsoon) => must(speed.get(`${district}|${hour}|${monsoon}`), `speed ${district}/${hour}/${monsoon}`),
    calendar,
  };
}

export function capabilityCost(v: Vehicle): number {
  return CAPABILITY_COST.reefer * (v.temp === "reefer" ? 1 : 0) + CAPABILITY_COST.van * (v.type === "van" ? 1 : 0);
}

/** Binds an order to its outlet (Python Order.__post_init__). */
export function makeOrder(R: Reference, o: OrderInput): Order {
  const outlet = R.outlets.get(o.outletId);
  if (!outlet) throw new Error(`unknown outlet ${o.outletId}`);
  return {
    ref: o.ref,
    outletId: o.outletId,
    temp: o.temp,
    units: o.units,
    kg: o.kg,
    m3: o.m3,
    deferredYesterday: o.deferredYesterday ?? 0,
    daysSinceLastServed: o.daysSinceLastServed ?? 1,
    outlet,
  };
}

export function district(R: Reference, name: string): District {
  return must(R.districts.get(name), `district ${name}`);
}

export function vehicle(R: Reference, id: string): Vehicle {
  return must(R.vehicles.get(id), `vehicle ${id}`);
}

/** Python string ordering (code points), never locale-aware. */
export function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function must<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Error(`missing reference data: ${what}`);
  return v;
}
