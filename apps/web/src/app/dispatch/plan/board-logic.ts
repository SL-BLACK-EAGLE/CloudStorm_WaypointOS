/**
 * D-03 board logic, run in the browser with the same planner code the server uses:
 * every drag is checked against rules 1-7, delivery windows and fuel before it is sent.
 */
import {
  checkVehicleDay,
  createReference,
  makeOrder,
  tripMinutes,
  window as budgetWindow,
  capabilityCost,
  type DayContext,
  type Order,
  type OrderInput,
  type Reference,
  type ReferenceInput,
  type Vehicle,
} from "@waypoint/planner";

export interface BoardTrip {
  id: string;
  code: string;
  vehicleId: string;
  tripNo: number;
  status: string;
  departureMin: number | null;
  orderIds: string[];
  arrivals: Record<string, number>;
  lateRisk: string[];
}

export interface BoardInput {
  ref: Omit<ReferenceInput, "calendar">;
  ctx: DayContext;
  status: Record<string, string>;
  fuelUsed: Record<string, number>;
  orders: OrderInput[];
  trips: BoardTrip[];
}

export type Target = { vehicleId: string; tripNo: number | "new" };

export interface Verdict {
  ok: boolean;
  code: string | null;
  title: string;
  detail: string;
}

export class Board {
  readonly R: Reference;
  readonly orders: Map<string, Order>;
  readonly day: Map<string, Order[][]>;
  readonly vehicles: Vehicle[];

  constructor(readonly input: BoardInput) {
    this.R = createReference({ ...input.ref, calendar: [] });
    this.orders = new Map(input.orders.map((o) => [o.ref, makeOrder(this.R, o)]));
    this.day = new Map();
    const sorted = [...input.trips].sort((a, b) => a.vehicleId.localeCompare(b.vehicleId) || a.tripNo - b.tripNo);
    for (const tr of sorted) {
      const list = this.day.get(tr.vehicleId) ?? [];
      list.push(tr.orderIds.map((id) => this.orders.get(id)!).filter(Boolean));
      this.day.set(tr.vehicleId, list);
    }
    this.vehicles = [...this.R.vehicles.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  vehicleOf(orderId: string): string | null {
    for (const [v, ts] of this.day) if (ts.some((t) => t.some((o) => o.ref === orderId))) return v;
    return null;
  }

  /** The vehicle's day if `orderId` moved to `target` (mirrors the server's moveOrder). */
  propose(orderId: string, target: Target): Order[][] {
    const order = this.orders.get(orderId)!;
    const before = this.day.get(target.vehicleId) ?? [];
    const without = before.map((t) => t.filter((o) => o.ref !== orderId)).filter((t) => t.length > 0);
    if (target.tripNo === "new") return [...without, [order]];
    const trip = before[target.tripNo - 1];
    if (!trip) return [...without, [order]];
    const next = without.map((t) => (t.some((o) => trip.includes(o)) ? [...t, order] : t));
    return next.some((t) => t.includes(order)) ? next : [...without, [order]];
  }

  check(orderId: string, target: Target): Verdict {
    const order = this.orders.get(orderId);
    const v = this.R.vehicles.get(target.vehicleId);
    if (!order || !v) return { ok: false, code: "UNKNOWN", title: "Unknown", detail: "" };
    if (this.input.status[v.id] !== "available") {
      return { ok: false, code: "IN_WORKSHOP", title: "In the workshop", detail: `${v.id} is in the workshop today and cannot be allocated.` };
    }
    if (target.tripNo !== "new" && this.vehicleOf(orderId) === v.id && (this.day.get(v.id)?.[target.tripNo - 1] ?? []).some((o) => o.ref === orderId)) {
      return { ok: false, code: "SAME", title: "Already here", detail: "" };
    }
    const chk = checkVehicleDay(this.R, v.id, this.propose(orderId, target), this.input.ctx, "LIVE", this.input.fuelUsed[v.id] ?? 0);
    if (chk.ok) return { ok: true, code: null, title: "Fits", detail: "" };
    return { ok: false, code: chk.code, ...describe(chk.code ?? "", order, v) };
  }

  /** Legal slots for an order, best first: an existing trip to the same brand + district, then a new trip, least capable vehicle first. */
  legalSlots(orderId: string, limit = 5): Array<Target & { label: string }> {
    const order = this.orders.get(orderId)!;
    const out: Array<Target & { label: string; rank: number }> = [];
    for (const v of this.vehicles) {
      if (this.input.status[v.id] !== "available" || v.depot !== order.outlet.depot) continue;
      const ts = this.day.get(v.id) ?? [];
      ts.forEach((t, i) => {
        if (t.some((o) => o.ref === orderId)) return;
        const same = t[0]?.outlet.brand === order.outlet.brand && t[0]?.outlet.district === order.outlet.district;
        if (!same) return;
        if (this.check(orderId, { vehicleId: v.id, tripNo: i + 1 }).ok)
          out.push({ vehicleId: v.id, tripNo: i + 1, label: `${v.id} trip ${i + 1} (${t[0]!.outlet.district})`, rank: capabilityCost(v) });
      });
      if (ts.length < 2 && this.check(orderId, { vehicleId: v.id, tripNo: "new" }).ok)
        out.push({ vehicleId: v.id, tripNo: "new", label: `${v.id} new trip ${ts.length + 1}`, rank: 10 + capabilityCost(v) });
    }
    return out.sort((a, b) => a.rank - b.rank).slice(0, limit);
  }

  /** Budget minutes a vehicle uses in each window. */
  minutes(vehicleId: string) {
    const used = { Fresh: 0, Day: 0 };
    for (const t of this.day.get(vehicleId) ?? []) {
      const f = t[0]!;
      used[budgetWindow(f.outlet.brand)] += tripMinutes(this.R, f.outlet.brand, f.outlet.district, t.map((o) => o.outlet.dock));
    }
    return used;
  }
}

function describe(code: string, order: Order, v: Vehicle): { title: string; detail: string } {
  switch (code) {
    case "R2_R3_R4_VEHICLE_TYPE":
      if (order.temp === "chilled" && v.temp !== "reefer")
        return { title: "needs reefer", detail: `${order.outletId} is chilled. ${v.id} is an ambient ${v.type} (rule 2).` };
      if (order.outlet.parking === "van_only" && v.type !== "van")
        return { title: "needs van", detail: `${order.outletId} is van-only. ${v.id} is a truck (rule 3).` };
      return { title: "wrong depot", detail: `${v.id} serves ${v.depot} only (rule 4).` };
    case "R1_BRAND_DISTRICT":
      return { title: "one brand, one district", detail: `A trip carries one brand to one district; ${order.outletId} is ${order.outlet.brand} in ${order.outlet.district} (rule 1).` };
    case "R6_WEIGHT":
      return { title: "over weight", detail: `${v.id} would exceed its ${v.capKg.toLocaleString("en-US")} kg limit (rule 6).` };
    case "R6_VOLUME":
      return { title: "over volume", detail: `${v.id} would exceed its ${v.capM3} m³ limit (rule 6).` };
    case "R7_TRIP_LIMIT":
      return { title: "2 trips max", detail: `${v.id} already runs two trips today (rule 7).` };
    case "R7_FRESH_BUDGET_270":
      return { title: "over 270 Fresh min", detail: `${v.id}'s Fresh trips would exceed the 270-minute 03:30–08:00 budget (rule 7).` };
    case "R7_DAY_BUDGET_480":
      return { title: "over 480 day min", detail: `${v.id}'s Style/Tech trips would exceed the 480-minute day budget (rule 7).` };
    case "FUEL_QUOTA":
      return { title: "fuel quota", detail: `${v.id} has not enough weekly fuel quota left.` };
    case "WINDOW_LATE":
      return { title: "misses window", detail: `A stop on ${v.id} would arrive after its delivery window closes.` };
    case "TRIP2_WINDOW_LATE":
      return { title: "trip 2 too late", detail: `${v.id} cannot get back, reload and reach the outlet before its window closes.` };
    default:
      return { title: code, detail: code };
  }
}
