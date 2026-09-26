/** Display formatting shared by server and client components. */

/** minutes after midnight -> "HH:MM" (rounded half-to-even like the planner's minToHhmm). */
export function hhmm(min: number | null | undefined): string {
  if (min === null || min === undefined || Number.isNaN(min)) return "--:--";
  let m = Math.round(min);
  if (Math.abs(min % 1) === 0.5 && m % 2 !== 0) m -= 1;
  const h = Math.floor(m / 60) % 24;
  return `${String(h).padStart(2, "0")}:${String(((m % 60) + 60) % 60).padStart(2, "0")}`;
}

export function windowText(open: number, close: number) {
  return `${hhmm(open)}–${hhmm(close)}`;
}

export const kg = (n: number, digits = 1) =>
  `${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })} kg`;
export const m3 = (n: number, digits = 2) =>
  `${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })} m³`;
export const int = (n: number) => n.toLocaleString("en-US");

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2025-12-23" -> "Tue 23 Dec" (optionally with the year). */
export function dayLabel(iso: string, withYear = false) {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  const base = `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
  return withYear ? `${base} ${d.getUTCFullYear()}` : base;
}

export const DOCK_LABEL = { rear_dock: "rear dock", street: "street", mall_bay: "mall bay" } as const;

/** Countdown text "1 h 48 m" from minutes. */
export function duration(min: number) {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h} h ${m % 60} m` : `${m} m`;
}
