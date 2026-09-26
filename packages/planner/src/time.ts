/** Clock helpers. Times are minutes after midnight, Asia/Colombo. */

export function hhmmToMin(s: string): number {
  return Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
}

/** Python `round()` for integers: round half to even. */
export function roundHalfEven(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

export function minToHhmm(t: number): string {
  const m = roundHalfEven(t);
  const h = Math.floor(m / 60);
  return `${String(h).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Python `round(x, n)` for the rank tie-break in F4 (exact ties are vanishingly rare). */
export function roundTo(x: number, n: number): number {
  return Number(x.toFixed(n));
}

export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
