"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

const SERIES = [
  { key: "Fresh", color: "var(--chart-fresh)" },
  { key: "Style", color: "var(--chart-style)" },
  { key: "Tech", color: "var(--chart-tech)" },
] as const;

export interface DemandWeek {
  label: string;
  Fresh: number;
  Style: number;
  Tech: number;
  chilled: number;
}

const W = 720;
const H = 240;
const PAD = { top: 12, right: 56, bottom: 28, left: 44 };

/** Weekly forecast volume by brand, stacked. One axis (m³); hover a week for its values; a table view for exact numbers. */
export function DemandChart({ weeks }: { weeks: DemandWeek[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...weeks.map((w) => w.Fresh + w.Style + w.Tech));
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / weeks.length;
  const barW = Math.min(36, slot * 0.56);
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const fmt = (v: number) => v.toLocaleString("en-GB", { maximumFractionDigits: 0 });
  const last = weeks.length - 1;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-muted-foreground">
            <span className="size-2.5 rounded-sm" style={{ background: s.color }} />
            {s.key}
          </span>
        ))}
        <span className="text-muted-foreground">· m³ per ISO week</span>
        <button onClick={() => setTable((v) => !v)} className="ml-auto text-[13px] underline-offset-4 hover:underline">
          {table ? "Show chart" : "Show table"}
        </button>
      </div>

      {table ? (
        <div className="overflow-x-auto">
          <table className="num w-full text-sm">
            <thead className="text-left text-[13px] text-muted-foreground">
              <tr className="border-b">
                <th className="py-1.5 pr-3 font-medium">Week</th>
                {SERIES.map((s) => (
                  <th key={s.key} className="py-1.5 pr-3 text-right font-medium">
                    {s.key}
                  </th>
                ))}
                <th className="py-1.5 pr-3 text-right font-medium">Chilled</th>
                <th className="py-1.5 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.label} className="border-b last:border-0">
                  <td className="py-1.5 pr-3">{w.label}</td>
                  {SERIES.map((s) => (
                    <td key={s.key} className="py-1.5 pr-3 text-right">
                      {fmt(w[s.key])}
                    </td>
                  ))}
                  <td className="py-1.5 pr-3 text-right">{fmt(w.chilled)}</td>
                  <td className="py-1.5 text-right font-medium">{fmt(w.Fresh + w.Style + w.Tech)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Weekly forecast volume by brand">
            {Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step).map((v) => (
              <g key={v}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
                <text x={PAD.left - 8} y={y(v) + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">
                  {fmt(v)}
                </text>
              </g>
            ))}
            {weeks.map((w, i) => {
              const x = PAD.left + slot * i + (slot - barW) / 2;
              let acc = 0;
              const segs = SERIES.map((s) => {
                const y0 = y(acc);
                acc += w[s.key];
                return { ...s, y0, y1: y(acc), v: w[s.key] };
              }).filter((s) => s.v > 0);
              return (
                <g key={w.label} opacity={hover === null || hover === i ? 1 : 0.45}>
                  {segs.map((s, k) => {
                    const h = Math.max(0, s.y0 - s.y1 - (k > 0 ? 2 : 0)); // 2px surface gap between stacked segments
                    const isTop = k === segs.length - 1;
                    return isTop ? (
                      <path key={s.key} d={roundedTop(x, s.y1, barW, h, Math.min(4, h))} fill={s.color} />
                    ) : (
                      <rect key={s.key} x={x} y={s.y1 + (k > 0 ? 2 : 0)} width={barW} height={h} fill={s.color} />
                    );
                  })}
                  <text x={x + barW / 2} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                    {w.label}
                  </text>
                  {i === last &&
                    segs.map((s) => (
                      <text key={s.key} x={x + barW + 6} y={(s.y0 + s.y1) / 2 + 4} className="fill-muted-foreground text-[11px]">
                        {s.key}
                      </text>
                    ))}
                  {/* hit target wider than the mark */}
                  <rect
                    x={PAD.left + slot * i}
                    y={PAD.top}
                    width={slot}
                    height={plotH}
                    fill="transparent"
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                  />
                </g>
              );
            })}
          </svg>
          {hover !== null && weeks[hover] && (
            <div
              className={cn("pointer-events-none absolute top-2 z-10 min-w-40 rounded-md border bg-popover p-2.5 text-[13px] shadow-md")}
              style={{ left: `${Math.min(78, ((PAD.left + slot * hover + slot) / W) * 100)}%` }}
            >
              <p className="font-medium">{weeks[hover].label}</p>
              {SERIES.map((s) => (
                <p key={s.key} className="num flex items-center justify-between gap-4">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="size-2 rounded-sm" style={{ background: s.color }} />
                    {s.key}
                  </span>
                  {fmt(weeks[hover][s.key])} m³
                </p>
              ))}
              <p className="num mt-1 flex justify-between gap-4 border-t pt-1">
                <span className="text-muted-foreground">Chilled</span>
                {fmt(weeks[hover].chilled)} m³
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

function niceStep(raw: number) {
  const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
