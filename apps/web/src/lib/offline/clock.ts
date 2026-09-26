import type { ClockInfo } from "./types";

/** Business time on the phone, computed offline from the clock snapshot in the pack. */
export function clockNow(c: ClockInfo, realNow = Date.now()) {
  const base = Date.parse(`${c.at}Z`);
  const ms = c.running ? base + (realNow - c.anchorReal) * c.speed : base;
  const iso = new Date(ms).toISOString().slice(0, 19);
  return { iso, date: iso.slice(0, 10), minute: Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16)) + Number(iso.slice(17, 19)) / 60 };
}

/** Time-ordered UUID v7 (the outbox replays in creation order). */
export function uuidv7(): string {
  const ms = BigInt(Date.now());
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  for (let i = 0; i < 6; i++) b[i] = Number((ms >> BigInt(8 * (5 - i))) & BigInt(255));
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
