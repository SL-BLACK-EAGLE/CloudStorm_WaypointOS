import "server-only";
import { and, asc, eq, gte, isNotNull } from "@waypoint/db/orm";
import { dayLabel } from "@/lib/format";
import { db, t } from "../db";

/** "Christmas ramp 0.8 · not a payday · no monsoon" for a run date (D-01 header line). */
export async function dayConditions(runDate: string) {
  const [c] = await db().select().from(t.calendarDays).where(eq(t.calendarDays.date, runDate));
  if (!c) return { text: "", festival: null as string | null, ramp: 0 };
  const [next] = await db()
    .select({ festival: t.calendarDays.festival, date: t.calendarDays.date })
    .from(t.calendarDays)
    .where(and(gte(t.calendarDays.date, runDate), isNotNull(t.calendarDays.festival)))
    .orderBy(asc(t.calendarDays.date))
    .limit(1);
  const name = next?.festival ? next.festival.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()) : null;
  const parts = [
    c.festivalRamp > 0 && name ? `${name} ramp ${c.festivalRamp.toFixed(1)}` : c.isHoliday ? "holiday" : null,
    c.isPayday ? "payday" : "not a payday",
    c.monsoon ? "monsoon" : "no monsoon",
  ].filter(Boolean);
  return { text: parts.join(" · "), festival: name, ramp: c.festivalRamp, label: dayLabel(runDate, true) };
}
