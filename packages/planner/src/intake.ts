/** F1 order intake and cutoff. */
import { CUTOFF_MIN } from "./params";
import type { Reference } from "./reference";
import { addDays, hhmmToMin } from "./time";
import type { Temp } from "./types";

export function isOperating(R: Reference, day: string): boolean {
  const c = R.calendar.get(day);
  if (!c) throw new Error(`calendar has no row for ${day}`);
  return c.isOperating === 1;
}

export function nextOperatingDay(R: Reference, day: string): string {
  let d = addDays(day, 1);
  while (!isOperating(R, d)) d = addDays(d, 1);
  return d;
}

export function previousOperatingDay(R: Reference, day: string): string {
  let d = addDays(day, -1);
  while (!isOperating(R, d)) d = addDays(d, -1);
  return d;
}

export type IntakeStatus = "CONFIRMED" | "REJECT";
export interface IntakeResult {
  status: IntakeStatus;
  runDate: string | null;
  reason: string;
}

/** F1. requestedDate/receivedDate are ISO dates, receivedTime is HH:MM. */
export function intake(
  R: Reference,
  outletId: string,
  temp: Temp,
  kg: number,
  m3: number,
  requestedDate: string,
  receivedDate: string,
  receivedTime: string,
): IntakeResult {
  const outlet = R.outlets.get(outletId);
  if (!outlet) throw new Error(`unknown outlet ${outletId}`);
  if (outlet.brand !== "Fresh" && temp === "chilled") {
    return { status: "REJECT", runDate: null, reason: "ONLY_FRESH_CAN_BE_CHILLED" }; // A1 -> A2
  }
  const fleet = [...R.vehicles.values()].filter(
    (v) =>
      v.depot === outlet.depot && // A3
      (outlet.parking !== "van_only" || v.type === "van") &&
      (temp !== "chilled" || v.temp === "reefer"),
  );
  if (!fleet.some((v) => kg <= v.capKg && m3 <= v.capM3)) {
    return { status: "REJECT", runDate: null, reason: "SPLIT_ORDER_EXCEEDS_LARGEST_VEHICLE" }; // A4 -> A5
  }
  let run = requestedDate;
  const reasons: string[] = [];
  if (!isOperating(R, run)) {
    run = nextOperatingDay(R, run); // A6 -> A7
    reasons.push("NON_OPERATING_DAY");
  }
  const cutoffDay = previousOperatingDay(R, run); // A9
  const received = hhmmToMin(receivedTime);
  if (receivedDate > cutoffDay || (receivedDate === cutoffDay && received > CUTOFF_MIN)) {
    run = nextOperatingDay(R, run); // A10 -> A11
    reasons.push("AFTER_CUTOFF");
  }
  return { status: "CONFIRMED", runDate: run, reason: reasons.join("+") || "ON_TIME" }; // A12
}
