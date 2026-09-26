import "server-only";
import { isOperating, nextOperatingDay } from "@waypoint/planner";
import { CUTOFF_MIN } from "@/lib/time-rules";
import { now, type BusinessNow } from "./clock";
import { reference } from "./reference";

/**
 * Which run a screen is about, from the business clock.
 * - planning run: the run the dispatcher is building (tomorrow's, or today's until 04:00)
 * - active run: the run being ordered-for-cutoff / loaded / driven / received
 *   (after the 16:00 cutoff that is the next operating day)
 */
export async function runs(clock?: BusinessNow) {
  const c = clock ?? (await now());
  const R = await reference();
  const todayOperating = R.calendar.has(c.date) && isOperating(R, c.date);
  const next = nextOperatingDay(R, c.date);
  const planning = c.minute < 4 * 60 && todayOperating ? c.date : next;
  const active = c.minute >= CUTOFF_MIN ? next : todayOperating ? c.date : next;
  return { clock: c, planning, active, cutoffPassed: c.minute >= CUTOFF_MIN };
}
