"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { BrandMark, StatusPill, TempTag } from "@/components/wp/chips";
import { hhmm, kg, m3 } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface QueueItem {
  id: string;
  outletId: string;
  brand: "Fresh" | "Style" | "Tech";
  temp: "chilled" | "ambient";
  units: number;
  kg: number;
  m3: number;
  district: string;
  dock: string;
  parking: string;
  mallWindow: string | null;
  open: number;
  close: number;
  deferredYesterday: number;
  daysSinceLastServed: number;
  receivedAt: string | null;
  planState: "confirmed" | "planned" | "deferred";
  planWhere: string | null;
}

/** D-02 table: district chips, search, one row per order with what decides its vehicle. */
export function QueueTable({ items }: { items: QueueItem[] }) {
  const [district, setDistrict] = useState<string>("All");
  const [q, setQ] = useState("");
  const districts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) m.set(i.district, (m.get(i.district) ?? 0) + 1);
    return [...m];
  }, [items]);
  const shown = items.filter(
    (i) =>
      (district === "All" || i.district === district) &&
      (!q || i.id.toLowerCase().includes(q.toLowerCase()) || i.outletId.toLowerCase().includes(q.toLowerCase())),
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" data-tour="filters">
        <div role="tablist" aria-label="District" className="flex flex-wrap gap-1.5">
          {[["All", items.length] as const, ...districts].map(([d, n]) => (
            <button
              key={d}
              role="tab"
              aria-selected={district === d}
              onClick={() => setDistrict(d)}
              className={cn(
                "h-8 rounded-full border px-3 text-sm text-muted-foreground transition-colors hover:text-foreground",
                district === d && "border-foreground bg-foreground font-medium text-background hover:text-background",
              )}
            >
              {d} <span className="num">{n}</span>
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-full sm:w-56">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find order or outlet" className="pl-8" aria-label="Find order or outlet" />
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card" data-tour="queue">
        <table className="w-full text-sm">
          <thead className="text-left text-[13px] text-muted-foreground">
            <tr className="border-b">
              <th className="px-4 py-2.5 font-medium">Order</th>
              <th className="px-3 py-2.5 font-medium">Outlet</th>
              <th className="px-3 py-2.5 font-medium">Temp</th>
              <th className="px-3 py-2.5 text-right font-medium">Weight</th>
              <th className="px-3 py-2.5 text-right font-medium">Volume</th>
              <th className="px-3 py-2.5 font-medium">Window</th>
              <th className="px-3 py-2.5 font-medium">Dock</th>
              <th className="px-3 py-2.5 font-medium">Access</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((i, k) => {
              const repeatOutlet = k > 0 && shown[k - 1]!.outletId === i.outletId;
              return (
                <tr key={i.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="num px-4 py-2 text-muted-foreground">{i.id}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-2">
                      <BrandMark brand={i.brand} size={18} />
                      <span className={cn("num font-semibold", repeatOutlet && "text-muted-foreground")}>{i.outletId}</span>
                      {i.deferredYesterday > 0 && (
                        <span className="rounded-sm border border-deferred-border bg-deferred-bg px-1 text-[11px] font-semibold text-deferred" title="Skipped on the previous run: priority today">
                          skipped yesterday
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <TempTag temp={i.temp} />
                  </td>
                  <td className="num px-3 py-2 text-right">{kg(i.kg)}</td>
                  <td className="num px-3 py-2 text-right">{m3(i.m3, 3)}</td>
                  <td className="num px-3 py-2">
                    {hhmm(i.open)}–{hhmm(i.close)}
                  </td>
                  <td className="num px-3 py-2 text-muted-foreground">{i.dock}</td>
                  <td className="px-3 py-2">
                    {i.parking === "normal" ? (
                      <span className="text-muted-foreground">normal</span>
                    ) : (
                      <span className="num rounded-md border border-foreground/60 px-2 py-0.5 text-[13px]" title={i.mallWindow ? `Mall window ${i.mallWindow}` : undefined}>
                        {i.parking}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {i.planState === "planned" ? (
                      <StatusPill status="planned">{i.planWhere}</StatusPill>
                    ) : i.planState === "deferred" ? (
                      <StatusPill status="deferred">Deferred in draft</StatusPill>
                    ) : (
                      <span className="rounded-md border px-2 py-0.5 text-[13px] font-medium">Confirmed</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                  No orders match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[13px] text-muted-foreground">
        Showing {shown.length} of {items.length} orders. A Fresh outlet&apos;s chilled and dry orders are separate rows because they need different
        vehicles.
      </p>
    </div>
  );
}
