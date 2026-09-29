"use client";

import { ArrowRight, Check, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { BrandMark, StatusPill, TempTag, ViolationChip } from "@/components/wp/chips";
import { Meter } from "@/components/wp/meter";
import { Panel } from "@/components/wp/panel";
import { dayLabel, hhmm, kg as fmtKg } from "@/lib/format";
import { cn } from "@/lib/utils";
import { decideDeferralAction } from "./actions";

type Preview = {
  tripNo: number;
  departure: number;
  sequence: Array<{ outletId: string; arrive: number }>;
  arrive: number;
  close: number;
  margin: number;
  kg: number;
  capKg: number;
  minutes: number;
  budget: number;
} | null;

export interface ReviewRow {
  orderId: string;
  outletId: string;
  district: string;
  dock: string;
  brand: "Fresh" | "Style" | "Tech";
  temp: "chilled" | "ambient";
  kg: number;
  m3: number;
  open: number;
  close: number;
  kind: string;
  reasonCode: string;
  explanation: string;
  decided: boolean;
  newRunDate: string | null;
  deferredYesterday: number;
  daysSinceLastServed: number;
  slots: Array<{ vehicleId: string; tripNo: number | "new"; label: string; preview: Preview }>;
  swap: { outOrderId: string; outOutletId: string; outWhy: string; ok: boolean; why: string | null; vehicleId: string | null; preview: Preview } | null;
  sibling: { orderId: string; tripCode: string; vehicleId: string; arrive: number | null; temp: string } | null;
}

const CLASS: Record<string, { label: string; cls: string }> = {
  UNAVOIDABLE: { label: "Unavoidable", cls: "text-exception" },
  CAPACITY_FORCED: { label: "Capacity", cls: "text-late-risk" },
  CHOSEN: { label: "Chosen", cls: "text-deferred" },
  MANUAL: { label: "Manual", cls: "text-muted-foreground" },
};

export function DeferralReview({ planId, rows }: { planId: string; rows: ReviewRow[] }) {
  const [tab, setTab] = useState<"all" | "REPEAT" | "UNAVOIDABLE" | "CAPACITY_FORCED" | "CHOSEN">("all");
  const [selected, setSelected] = useState<string | null>(rows.find((r) => needsDecision(r) && !r.decided)?.orderId ?? rows[0]?.orderId ?? null);
  const shown = rows.filter((r) => tab === "all" || (tab === "REPEAT" ? r.deferredYesterday > 0 : r.kind === tab || (tab === "CHOSEN" && r.kind === "MANUAL")));
  const repeats = rows.filter((r) => r.deferredYesterday > 0).length;
  const row = rows.find((r) => r.orderId === selected) ?? null;
  const count = (k: string) => rows.filter((r) => r.kind === k).length;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Panel className="overflow-hidden">
        <div role="tablist" className="flex gap-1.5 border-b p-3">
          {(
            [
              ["all", `All ${rows.length}`],
              ...(repeats ? ([["REPEAT", `Skipped twice ${repeats}`]] as const) : []),
              ["UNAVOIDABLE", `Unavoidable ${count("UNAVOIDABLE")}`],
              ["CAPACITY_FORCED", `Capacity ${count("CAPACITY_FORCED")}`],
              ["CHOSEN", `Chosen ${count("CHOSEN") + count("MANUAL")}`],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cn("h-8 rounded-full border px-3 text-sm text-muted-foreground", tab === k && "border-foreground bg-foreground font-medium text-background")}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[13px] text-muted-foreground">
              <tr className="border-b">
                <th className="px-4 py-2 font-medium">Outlet · order</th>
                <th className="px-3 py-2 font-medium">Load</th>
                <th className="px-3 py-2 font-medium">Window</th>
                <th className="px-3 py-2 font-medium">Class</th>
                <th className="px-3 py-2 font-medium">Reason or best option</th>
                <th className="px-4 py-2 font-medium">Other order today</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const c = CLASS[r.kind] ?? CLASS.MANUAL!;
                const best = r.slots[0];
                return (
                  <tr
                    key={r.orderId}
                    onClick={() => setSelected(r.orderId)}
                    className={cn("cursor-pointer border-b last:border-0 hover:bg-muted/40", selected === r.orderId && "bg-accent/60")}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <BrandMark brand={r.brand} size={16} />
                        <span className="num font-semibold">{r.outletId}</span>
                        <span className="text-muted-foreground">{r.district}</span>
                      </div>
                      {r.deferredYesterday > 0 && <ViolationChip className="mt-1 h-6 text-[12px]">Skipped twice in a row</ViolationChip>}
                      <span className="num text-[12px] text-muted-foreground">{r.orderId}</span>
                    </td>
                    <td className="num px-3 py-2.5 whitespace-nowrap">
                      {fmtKg(r.kg)}
                      <br />
                      <span className="text-[12px] text-muted-foreground">{r.m3.toFixed(3)} m³</span>
                    </td>
                    <td className="num px-3 py-2.5">
                      {hhmm(r.open)}–{hhmm(r.close)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={cn("font-semibold", c.cls)}>{c.label}</span>
                      <br />
                      <span className="text-[12px] text-muted-foreground">
                        {needsDecision(r) ? (r.decided ? "Decided" : r.deferredYesterday ? "Needs a reason · 2nd run" : "Needs decision") : r.kind === "MANUAL" ? "Decided" : "Reason filled in"}
                      </span>
                    </td>
                    <td className="max-w-[380px] px-3 py-2.5 text-[13px]">
                      {best ? (
                        <span>
                          Free slot · {best.label}
                          {best.preview && ` · arrives ${hhmm(best.preview.arrive)}`}
                        </span>
                      ) : r.swap?.ok ? (
                        <span>
                          Serve instead of {r.swap.outOutletId} ({r.swap.outWhy}) on {r.swap.vehicleId}
                          {r.swap.preview && ` · arrives ${hhmm(r.swap.preview.arrive)}`}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{r.explanation}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-[13px]">
                      {r.sibling ? (
                        <span className="num">
                          {r.sibling.tripCode} · planned {hhmm(r.sibling.arrive)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                    Nothing deferred in this class.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {row ? <DecisionPanel key={row.orderId} planId={planId} row={row} /> : <Panel className="p-4 text-sm text-muted-foreground">Select a deferral.</Panel>}
    </div>
  );
}

/** Chosen deferrals and outlets skipped two runs in a row need a recorded decision before publishing. */
function needsDecision(r: ReviewRow) {
  return r.kind === "CHOSEN" || r.deferredYesterday > 0;
}

function DecisionPanel({ planId, row }: { planId: string; row: ReviewRow }) {
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const c = CLASS[row.kind] ?? CLASS.MANUAL!;
  const decide = (fields: Record<string, string>) =>
    start(async () => {
      const f = new FormData();
      f.set("planId", planId);
      f.set("orderId", row.orderId);
      for (const [k, v] of Object.entries(fields)) f.set(k, v);
      const r = await decideDeferralAction(f);
      if (r.ok) toast.success(r.message);
      else toast.error(r.error);
    });
  const option = row.slots[0]
    ? { kind: "slot" as const, text: `Serve in free slot: ${row.slots[0].label}`, preview: row.slots[0].preview }
    : row.swap?.ok
      ? { kind: "swap" as const, text: `Serve instead of ${row.swap.outOutletId} on ${row.swap.vehicleId}`, preview: row.swap.preview }
      : null;
  const p = option?.preview ?? null;

  return (
    <Panel className="space-y-4 p-4">
      <div>
        <div className="flex items-center gap-2">
          <BrandMark brand={row.brand} size={20} />
          <h2 className="num text-lg font-semibold">{row.outletId}</h2>
          <span className="text-sm text-muted-foreground">
            {row.district} · {row.dock}
          </span>
        </div>
        <p className="num text-[13px] text-muted-foreground">
          {row.orderId} · {fmtKg(row.kg)} · {row.m3.toFixed(3)} m³ · {hhmm(row.open)}–{hhmm(row.close)}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <TempTag temp={row.temp} />
          <span className={cn("inline-flex h-7 items-center rounded-full border px-2.5 text-[13px] font-semibold", c.cls)}>{c.label}</span>
          {row.decided && <StatusPill status="delivered">Decided</StatusPill>}
        </div>
      </div>

      <p className="rounded-md border bg-muted/40 p-3 text-sm">{row.explanation}</p>

      {option && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">If served</h3>
          <p className="text-sm">{option.text}.</p>
          {option.kind === "swap" && row.swap && (
            <p className="text-[13px] text-muted-foreground">
              {row.swap.outOutletId} ({row.swap.outWhy}) would move to the next run instead - that is the trade-off the planner made.
            </p>
          )}
          {p && (
            <>
              <p className="num flex flex-wrap items-center gap-1 text-[13px]">
                {p.sequence.map((s, i) => (
                  <span key={s.outletId + i} className={cn("inline-flex items-center gap-1", s.outletId === row.outletId && "font-semibold")}>
                    {i > 0 && <ArrowRight className="size-3 text-muted-foreground" />}
                    {s.outletId} {hhmm(s.arrive)}
                  </span>
                ))}
              </p>
              <dl className="grid grid-cols-2 gap-2 text-[13px]">
                <dt className="text-muted-foreground">Window margin</dt>
                <dd className={cn("num text-right", p.margin < 20 && "text-late-risk")}>
                  {Math.round(p.margin)} min to {hhmm(p.close)}
                  {p.margin < 20 && " (under 20)"}
                </dd>
              </dl>
              <Meter label="Trip load" used={p.kg} total={p.capKg} valueLabel={`${p.kg.toFixed(1)} / ${p.capKg.toLocaleString("en-US")} kg`} />
              <Meter label={p.budget === 270 ? "Fresh minutes" : "Day minutes"} used={p.minutes} total={p.budget} />
            </>
          )}
        </section>
      )}

      <section className="space-y-1 text-sm">
        <h3 className="font-semibold">If kept deferred</h3>
        <p className="text-muted-foreground">
          It goes on the {row.newRunDate ? dayLabel(row.newRunDate) : "next"} run with priority (it cannot be skipped twice). The store manager is told why when the
          plan is published.
        </p>
        {row.sibling && (
          <p className="text-muted-foreground">
            Their other order ({row.sibling.orderId}) still arrives on {row.sibling.tripCode}, planned {hhmm(row.sibling.arrive)}.
          </p>
        )}
        <dl className="mt-2 grid grid-cols-2 gap-1 text-[13px]">
          <dt className="text-muted-foreground">Deferred last run</dt>
          <dd className="text-right">{row.deferredYesterday ? "Yes - top priority" : "No"}</dd>
          <dt className="text-muted-foreground">Days since last served</dt>
          <dd className="num text-right">{row.daysSinceLastServed}</dd>
        </dl>
      </section>

      {row.deferredYesterday > 0 && (
        <p className="rounded-md border border-violation/60 p-2.5 text-[13px]">
          <strong className="text-violation">Skipped on the previous run too.</strong> The planner gave this order top priority and it still did not fit.
          Serve it if an option exists; otherwise record why, and it goes first on the next run.
        </p>
      )}
      {((needsDecision(row) && !row.decided) || option) && (
        <div className="space-y-2">
          {needsDecision(row) && !row.decided && (
            <>
              <label htmlFor="reason" className="text-sm font-medium">
                Reason (required to keep deferred)
              </label>
              <Textarea id="reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. OUT041 was skipped yesterday; its chilled order goes first" />
            </>
          )}
          <div className="flex gap-2">
            {needsDecision(row) && !row.decided && (
              <Button size="desk" variant="outline" className="flex-1" disabled={pending || reason.trim().length < 5} onClick={() => decide({ decision: "keep", reason })}>
                {pending ? <Loader2 className="animate-spin" /> : <Check />} Keep deferred
              </Button>
            )}
            {option && (
              <Button
                size="desk"
                className="flex-1"
                disabled={pending}
                onClick={() =>
                  option.kind === "slot"
                    ? decide({ decision: "slot", vehicleId: row.slots[0]!.vehicleId, tripNo: String(row.slots[0]!.tripNo) })
                    : decide({ decision: "swap", outOrderId: row.swap!.outOrderId, reason })
                }
              >
                {pending && <Loader2 className="animate-spin" />}
                {option.kind === "slot" ? "Serve in slot" : "Serve instead"}
              </Button>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
