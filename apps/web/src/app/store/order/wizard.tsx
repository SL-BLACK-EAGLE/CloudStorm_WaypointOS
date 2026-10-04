"use client";

import { CheckCircle2, Loader2, Minus, Plus, Search, Snowflake, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TempTag } from "@/components/wp/chips";
import { Panel } from "@/components/wp/panel";
import { DOCK_LABEL, dayLabel, duration, hhmm } from "@/lib/format";
import { cn } from "@/lib/utils";
import { placeOrdersAction, type PlaceResult } from "../actions";
import { PageTour } from "@/components/wp/tour";
import { ORDER_DONE_TOUR, ORDER_LINES_TOUR, ORDER_REVIEW_TOUR } from "@/lib/tours/store";

type Item = {
  sku: string;
  name: string;
  category: string;
  temp: "chilled" | "ambient";
  unitKg: number;
  unitM3: number;
};
type Temp = "ambient" | "chilled";

/**
 * SM-02A (order lines) -> SM-02 (review: dry and chilled are two orders) -> confirmation.
 * Item names are scenario (the dataset has order totals only); weight and volume come from the lines.
 */
export function OrderWizard({
  outlet,
  catalog,
  runDate,
  afterCutoff,
  minsToCutoff,
  typical,
}: {
  outlet: {
    id: string;
    brand: "Fresh" | "Style" | "Tech";
    district: string;
    dock: "rear_dock" | "street" | "mall_bay";
    open: number;
    close: number;
  };
  catalog: Item[];
  runDate: string;
  afterCutoff: boolean;
  minsToCutoff: number;
  typical: { ambient: number; chilled: number };
}) {
  const [step, setStep] = useState<"lines" | "review" | "done">("lines");
  const [tab, setTab] = useState<Temp>("ambient");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [q, setQ] = useState("");
  const [result, setResult] = useState<Extract<PlaceResult, { ok: true }> | null>(null);
  const [pending, start] = useTransition();
  const fresh = outlet.brand === "Fresh";
  const bySku = useMemo(() => new Map(catalog.map((c) => [c.sku, c])), [catalog]);

  const totals = (temp: Temp) => {
    const lines = Object.entries(qty).filter(([sku, n]) => n > 0 && bySku.get(sku)?.temp === temp);
    return {
      lines: lines.length,
      units: lines.reduce((s, [, n]) => s + n, 0),
      kg: lines.reduce((s, [sku, n]) => s + bySku.get(sku)!.unitKg * n, 0),
      m3: lines.reduce((s, [sku, n]) => s + bySku.get(sku)!.unitM3 * n, 0),
    };
  };
  const dry = totals("ambient");
  const cold = totals("chilled");
  const set = (sku: string, n: number) => setQty((m) => ({ ...m, [sku]: Math.max(0, Math.min(5000, n)) }));

  const fillTypical = (temp: Temp) => {
    const items = catalog.filter((c) => c.temp === temp);
    const target = typical[temp] || (temp === "chilled" ? 40 : 80);
    if (!items.length) return;
    const each = Math.max(1, Math.round(target / Math.min(items.length, 6)));
    const next = { ...qty };
    items.slice(0, 6).forEach((c, i) => (next[c.sku] = i === 0 ? each + (target - each * Math.min(items.length, 6)) : each));
    setQty(next);
  };

  if (step === "done" && result) {
    return (
      <Panel className="mx-auto max-w-xl space-y-4 p-6" data-tour="confirmation">
        <PageTour id="sm02-done" steps={ORDER_DONE_TOUR} />
        <CheckCircle2 className="size-8 text-delivered" />
        <h1 className="text-2xl font-semibold">
          {result.orders.length} order{result.orders.length === 1 ? "" : "s"} received
        </h1>
        <p className="text-sm text-muted-foreground">
          {dayLabel(result.placedAt.slice(0, 10))} at {result.placedAt.slice(11, 16)}
          {afterCutoff ? " - after the 16:00 cutoff" : " - before the 16:00 cutoff"}, for delivery {dayLabel(result.orders[0]!.runDate)}.
        </p>
        <ul className="divide-y rounded-lg border">
          {result.orders.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-3 p-3 text-sm">
              <span>
                <span className="font-medium">{o.temp === "chilled" ? "Chilled order" : "Dry order"}</span>
                <span className="num block text-muted-foreground">
                  {o.id} · {o.units} units · {o.kg.toFixed(1)} kg · {o.m3.toFixed(3)} m³
                </span>
              </span>
              <span className="rounded-full border border-delivered-border bg-delivered-bg px-2.5 py-0.5 text-[13px] font-semibold text-delivered">
                Confirmed
              </span>
            </li>
          ))}
        </ul>
        <div className="rounded-lg bg-muted p-3 text-sm">
          <p className="font-medium">What happens next</p>
          <p className="text-muted-foreground">
            The delivery plan is published the evening before. Each order then shows an arrival time, or a notice with the reason if it has to move.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild size="desk">
            <Link href="/store">Done</Link>
          </Button>
          <Button asChild size="desk" variant="outline">
            <Link href="/store/track">View orders</Link>
          </Button>
        </div>
      </Panel>
    );
  }

  const shown = catalog.filter((c) => c.temp === tab && (!q || c.name.toLowerCase().includes(q.toLowerCase())));
  const header = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <ol className="mb-2 flex gap-3 text-[13px] text-muted-foreground" data-tour="steps">
          {["Order lines", "Review", "Confirmation"].map((s, i) => (
            <li
              key={s}
              className={cn(
                "flex items-center gap-1.5",
                (i === 0 && step === "lines") || (i === 1 && step === "review") ? "font-semibold text-foreground" : "",
              )}
            >
              <span className="num grid size-5 place-items-center rounded-full border text-[11px]">{i + 1}</span> {s}
            </li>
          ))}
        </ol>
        <h1 className="text-2xl font-semibold">Orders for {dayLabel(runDate)}</h1>
      </div>
      <div className="text-right">
        <p className="text-[13px] text-muted-foreground" data-tour="countdown">{afterCutoff ? "Cutoff passed - these go to" : "Cutoff 16:00 today"}</p>
        <p className="num text-lg font-semibold">{afterCutoff ? dayLabel(runDate) : `${duration(minsToCutoff)} left`}</p>
      </div>
    </div>
  );

  if (step === "review") {
    const orders = [
      {
        temp: "ambient" as const,
        t: dry,
        title: "Dry order · ambient",
        need: "Any truck can carry it",
      },
      {
        temp: "chilled" as const,
        t: cold,
        title: "Chilled order",
        need: "Needs a refrigerated vehicle",
      },
    ].filter((o) => o.t.lines > 0);
    return (
      <main className="space-y-5">
        <PageTour id="sm02-review" steps={ORDER_REVIEW_TOUR} />
        {header}
        {orders.length > 1 && (
          <p className="rounded-lg border bg-card p-4 text-sm" data-tour="two-orders">
            <strong>These are two separate orders.</strong> Chilled goods need a refrigerated vehicle and dry goods don&apos;t, so they may arrive on different
            trucks. If refrigerated space runs out, the chilled order can move to the next run - you&apos;ll hear why the evening before, not at the door.
          </p>
        )}
        <div className="grid gap-4 md:grid-cols-2" data-tour="review">
          {orders.map((o) => (
            <Panel key={o.temp} className="space-y-2 p-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">{o.title}</h2>
                <TempTag temp={o.temp} />
              </div>
              <p className="text-[13px] text-muted-foreground">{o.need}</p>
              <dl className="grid grid-cols-2 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Units</dt>
                <dd className="num text-right">{o.t.units}</dd>
                <dt className="text-muted-foreground">Weight</dt>
                <dd className="num text-right">{o.t.kg.toFixed(1)} kg</dd>
                <dt className="text-muted-foreground">Volume</dt>
                <dd className="num text-right">{o.t.m3.toFixed(3)} m³</dd>
              </dl>
              <p className="text-[13px] text-muted-foreground">
                Delivery {dayLabel(runDate)}, {hhmm(outlet.open)}–{hhmm(outlet.close)}, at the {DOCK_LABEL[outlet.dock]}
              </p>
              <button
                className="text-sm underline underline-offset-4"
                onClick={() => {
                  setTab(o.temp);
                  setStep("lines");
                }}
              >
                Edit order lines
              </button>
            </Panel>
          ))}
        </div>
        <p className="text-[13px] text-muted-foreground">Orders submitted after 16:00 go to the following run.</p>
        <div className="flex flex-wrap gap-2">
          <Button size="desk" variant="outline" onClick={() => setStep("lines")}>
            Back
          </Button>
          <Button
            size="desk"
            data-tour="submit"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await placeOrdersAction({
                  lines: Object.entries(qty)
                    .filter(([, n]) => n > 0)
                    .map(([sku, n]) => ({ sku, qty: n })),
                });
                if (r.ok) {
                  setResult(r);
                  setStep("done");
                } else toast.error(r.error);
              })
            }
          >
            {pending && <Loader2 className="animate-spin" />} Submit {orders.length} order{orders.length === 1 ? "" : "s"}
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="space-y-5">
      <PageTour id="sm02" steps={ORDER_LINES_TOUR} />
      {header}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel className="overflow-hidden">
          {fresh && (
            <div role="tablist" className="grid grid-cols-2 border-b" data-tour="order-tabs">
              {(["ambient", "chilled"] as const).map((k) => {
                const tt = k === "ambient" ? dry : cold;
                return (
                  <button
                    key={k}
                    role="tab"
                    aria-selected={tab === k}
                    onClick={() => setTab(k)}
                    className={cn("flex h-12 items-center justify-center gap-2 text-sm", tab === k && "border-b-2 border-foreground font-semibold")}
                  >
                    {k === "chilled" && <Snowflake className="size-4 text-chilled" />}
                    {k === "ambient" ? "Dry order · ambient" : "Chilled order"} <span className="num text-muted-foreground">{tt.units} units</span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 border-b p-3" data-tour="search">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={`Search items to add to the ${tab === "chilled" ? "chilled" : "dry"} order`}
                className="pl-8"
              />
            </div>
            <Button size="desk" variant="outline" onClick={() => fillTypical(tab)}>
              <Sparkles /> Typical order
            </Button>
          </div>
          <ul className="divide-y" data-tour="lines">
            {shown.map((c) => {
              const n = qty[c.sku] ?? 0;
              return (
                <li key={c.sku} className={cn("flex items-center gap-3 px-3 py-2", n > 0 && "bg-muted/40")}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.name}</p>
                    <p className="text-[12px] text-muted-foreground">
                      {c.category} · {c.unitKg.toFixed(1)} kg per unit
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button size="icon" variant="outline" aria-label={`Fewer ${c.name}`} onClick={() => set(c.sku, n - 1)} disabled={n === 0}>
                      <Minus />
                    </Button>
                    <input
                      value={n}
                      onChange={(e) => set(c.sku, Number(e.target.value) || 0)}
                      inputMode="numeric"
                      aria-label={`${c.name} units`}
                      className="num h-8 w-14 rounded-md border bg-background text-center"
                    />
                    <Button size="icon" variant="outline" aria-label={`More ${c.name}`} onClick={() => set(c.sku, n + 1)}>
                      <Plus />
                    </Button>
                    {n > 0 && (
                      <Button size="icon" variant="ghost" aria-label={`Remove ${c.name}`} onClick={() => set(c.sku, 0)}>
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="border-t p-3 text-[12px] text-muted-foreground">Item names are illustrative; the planner uses the weight and volume they add up to.</p>
        </Panel>
        <aside className="space-y-3" data-tour="totals">
          {[
            {
              k: "ambient" as const,
              t: dry,
              title: fresh ? "Dry order totals" : "Order totals",
            },
            ...(fresh
              ? [
                  {
                    k: "chilled" as const,
                    t: cold,
                    title: "Chilled order totals",
                  },
                ]
              : []),
          ].map(({ k, t: tt, title }) => (
            <Panel key={k} className="space-y-1 p-4 text-sm">
              <p className="flex items-center justify-between font-semibold">
                {title} {k === "chilled" && <TempTag temp="chilled" />}
              </p>
              <p className="num">
                {tt.units} units · {tt.kg.toFixed(1)} kg · {tt.m3.toFixed(3)} m³
              </p>
              <p className="text-[12px] text-muted-foreground">{k === "chilled" ? "Needs a refrigerated vehicle." : "Any truck can carry it."}</p>
            </Panel>
          ))}
          {fresh && (
            <p className="text-[12px] text-muted-foreground">
              Chilled items land in the chilled order by themselves, so they can&apos;t end up on a truck with no refrigeration.
            </p>
          )}
          <Button size="desk" className="w-full" disabled={dry.units + cold.units === 0} onClick={() => setStep("review")} data-tour="to-review">
            Continue to review
          </Button>
          <Button asChild size="desk" variant="ghost" className="w-full">
            <Link href="/store">Back to home</Link>
          </Button>
        </aside>
      </div>
    </main>
  );
}
