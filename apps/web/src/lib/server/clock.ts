import "server-only";
import { eq } from "@waypoint/db/orm";
import { cache } from "react";
import { db, t } from "./db";

/**
 * The business clock.
 *
 * The seeded operation is Tue 23 Dec 2025, so the app runs on a demo clock that the
 * /demo panel can set or let run. All times are Asia/Colombo wall-clock times; they are
 * handled as naive "YYYY-MM-DDTHH:MM:SS" strings to avoid timezone arithmetic.
 */
export interface ClockSetting {
  at: string;
  running: boolean;
  anchorReal: number;
  speed: number;
}

export interface BusinessNow {
  /** YYYY-MM-DDTHH:MM:SS */
  iso: string;
  /** YYYY-MM-DD */
  date: string;
  /** minutes after midnight */
  minute: number;
  running: boolean;
  speed: number;
}

const toMs = (iso: string) => Date.parse(`${iso}Z`);
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 19);

export function resolveClock(c: ClockSetting, realNow = Date.now()): BusinessNow {
  const ms = c.running ? toMs(c.at) + (realNow - c.anchorReal) * c.speed : toMs(c.at);
  const iso = fromMs(ms);
  const minute = Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
  return { iso, date: iso.slice(0, 10), minute, running: c.running, speed: c.speed };
}

export async function readClockSetting(): Promise<ClockSetting> {
  const [row] = await db().select().from(t.appSettings).where(eq(t.appSettings.key, "clock"));
  return (row?.value as ClockSetting | undefined) ?? { at: "2025-12-22T14:30:00", running: false, anchorReal: Date.now(), speed: 1 };
}

/** Business "now", memoised per request. */
export const now = cache(async (): Promise<BusinessNow> => resolveClock(await readClockSetting()));

export async function writeClock(next: Partial<Pick<ClockSetting, "at" | "running" | "speed">>) {
  const current = resolveClock(await readClockSetting());
  const value: ClockSetting = {
    at: next.at ?? current.iso,
    running: next.running ?? current.running,
    speed: next.speed ?? current.speed,
    anchorReal: Date.now(),
  };
  await db()
    .insert(t.appSettings)
    .values({ key: "clock", value })
    .onConflictDoUpdate({ target: t.appSettings.key, set: { value, updatedAt: new Date() } });
  return resolveClock(value);
}

/** The run date an order placed "now" is for (next operating day), before the planner's F1 intake. */
export function addDaysIso(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
