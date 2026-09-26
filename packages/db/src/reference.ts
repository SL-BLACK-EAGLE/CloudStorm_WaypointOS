/** Builds the planner's reference data from Postgres (outlets, fleet, districts, allowances, calendar, traffic). */
import type { ReferenceInput } from "@waypoint/planner";
import type { Executor } from "./client";
import { calendarDays, districts, outlets, serviceAllowances, trafficSpeed, vehicles } from "./schema";

export async function loadReference(db: Executor): Promise<ReferenceInput> {
  const [o, v, d, a, s, c] = await Promise.all([
    db.select().from(outlets),
    db.select().from(vehicles),
    db.select().from(districts),
    db.select().from(serviceAllowances),
    db.select().from(trafficSpeed),
    db.select().from(calendarDays),
  ]);
  return {
    outlets: o.map((x) => ({
      id: x.id,
      brand: x.brand,
      district: x.district,
      depot: x.depotId,
      dock: x.dockType,
      parking: x.parking,
      open: x.windowOpen,
      close: x.windowClose,
    })),
    vehicles: v.map((x) => ({
      id: x.id,
      type: x.type,
      temp: x.temp,
      capKg: x.weightCapKg,
      capM3: x.volumeCapM3,
      kmPerL: x.kmPerL,
      weeklyQuotaL: x.weeklyFuelQuotaL,
      depot: x.depotId,
    })),
    districts: d.map((x) => ({
      name: x.name,
      depot: x.depotId,
      outboundMin: x.outboundMin,
      interStopMin: x.interStopMin,
      depotKm: x.depotKm,
      interStopKm: x.interStopKm,
      freeFlowKmh: x.freeFlowKmh,
    })),
    allowance: a.map((x) => ({ brand: x.brand, dock: x.dockType, minutes: x.minutes })),
    speed: s.map((x) => ({ district: x.district, hour: x.hour, monsoon: x.monsoon, index: x.speedIndex })),
    calendar: c.map((x) => ({
      date: x.date,
      isOperating: x.isOperating,
      monsoon: x.monsoon,
      festivalRamp: x.festivalRamp,
      isPayday: x.isPayday,
      isoYear: x.isoYear,
      isoWeek: x.isoWeek,
    })),
  };
}
