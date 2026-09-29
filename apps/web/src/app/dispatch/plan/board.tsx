"use client";

import { Ban, Check, GripVertical, MoveRight, Search, SkipForward, Snowflake, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BrandMark, TempTag } from "@/components/wp/chips";
import { Meter } from "@/components/wp/meter";
import { hhmm, kg as fmtKg } from "@/lib/format";
import { cn } from "@/lib/utils";
import { tripMinutes } from "@waypoint/planner";
import { moveOrderAction } from "./actions";
import { OVERRIDABLE_CODES } from "@waypoint/planner";
import { Board, type BoardInput, type BoardTrip, type Target, type Verdict } from "./board-logic";

export interface BoardData extends BoardInput {
  planId: string;
  planStatus: "draft" | "published";
  version: number;
  depot: string;
  runDate: string;
  deferrals: Array<{ orderId: string; kind: string; reasonCode: string; explanation: string; lostToOrderId: string | null }>;
}

const KIND_STYLE: Record<string, string> = {
  UNAVOIDABLE: "text-exception",
  CAPACITY_FORCED: "text-late-risk",
  CHOSEN: "text-deferred",
  MANUAL: "text-muted-foreground",
};
const KIND_LABEL: Record<string, string> = { UNAVOIDABLE: "Unavoidable", CAPACITY_FORCED: "Capacity", CHOSEN: "Chosen", MANUAL: "Manual" };

type Selection = { kind: "trip"; vehicleId: string; tripNo: number } | { kind: "order"; orderId: string } | null;
type Blocked = { orderId: string; target: Target; verdict: Verdict; x: number; y: number; legal: Array<Target & { label: string }> };

export function PlanningBoard({ data, rerun }: { data: BoardData; rerun: React.ReactNode }) {
  const board = useMemo(() => new Board(data), [data]);
  const tripsByVehicle = useMemo(() => {
    const m = new Map<string, BoardTrip[]>();
    for (const tr of data.trips) m.set(tr.vehicleId, [...(m.get(tr.vehicleId) ?? []), tr].sort((a, b) => a.tripNo - b.tripNo));
    return m;
  }, [data.trips]);
  const [selection, setSelection] = useState<Selection>(() => (data.trips[0] ? { kind: "trip", vehicleId: data.trips[0].vehicleId, tripNo: data.trips[0].tripNo } : null));
  const [dragging, setDragging] = useState<string | null>(null);
  const [hover, setHover] = useState<{ key: string; verdict: Verdict } | null>(null);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [blockedCount, setBlockedCount] = useState(0);
  const [deferFor, setDeferFor] = useState<string | null>(null);
  const [moveFor, setMoveFor] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  const verdictCache = useRef(new Map<string, Verdict>());

  const deferredIds = new Set(data.deferrals.map((d) => d.orderId));
  const verdictFor = (orderId: string, target: Target) => {
    const key = `${orderId}>${target.vehicleId}|${target.tripNo}`;
    let v = verdictCache.current.get(key);
    if (!v) {
      v = board.check(orderId, target);
      verdictCache.current.set(key, v);
    }
    return v;
  };

  const send = (fields: Record<string, string>) =>
    start(async () => {
      const f = new FormData();
      f.set("planId", data.planId);
      for (const [k, v] of Object.entries(fields)) f.set(k, v);
      const r = await moveOrderAction(f);
      if (r.ok) toast.success(r.message);
      else toast.error(r.error);
      verdictCache.current.clear();
    });

  const drop = (orderId: string, target: Target, e: { clientX: number; clientY: number }) => {
    setHover(null);
    setDragging(null);
    const v = verdictFor(orderId, target);
    if (v.code === "SAME") return;
    if (!v.ok) {
      setBlockedCount((n) => n + 1);
      setBlocked({ orderId, target, verdict: v, x: e.clientX, y: e.clientY, legal: board.legalSlots(orderId, 3) });
      return;
    }
    send({ kind: "trip", orderId, vehicleId: target.vehicleId, tripNo: String(target.tripNo) });
  };

  // ── lanes grouped like the design: reefer trucks, reefer vans, ambient vans, ambient trucks
  const groups = [
    { title: "Reefer trucks", test: (v: { temp: string; type: string }) => v.temp === "reefer" && v.type === "truck" },
    { title: "Reefer vans", test: (v: { temp: string; type: string }) => v.temp === "reefer" && v.type === "van" },
    { title: "Ambient vans", test: (v: { temp: string; type: string }) => v.temp === "ambient" && v.type === "van" },
    { title: "Ambient trucks", test: (v: { temp: string; type: string }) => v.temp === "ambient" && v.type === "truck" },
  ];
  const match = (vehicleId: string) => {
    if (!q) return true;
    const s = q.toLowerCase();
    if (vehicleId.toLowerCase().includes(s)) return true;
    return (tripsByVehicle.get(vehicleId) ?? []).some((tr) => tr.orderIds.some((id) => id.toLowerCase().includes(s) || board.orders.get(id)?.outletId.toLowerCase().includes(s)));
  };
  const nearBudget = board.vehicles.filter((v) => board.minutes(v.id).Fresh >= 270 * 0.95);
  const stopsCount = data.trips.reduce((n, tr) => n + tr.orderIds.length, 0);

  return (
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b px-6 py-3">
        {rerun}
        <div className="relative w-56">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find outlet or vehicle" className="pl-8" aria-label="Find outlet or vehicle" />
        </div>
        <p className="text-sm text-muted-foreground">
          {tripsByVehicle.size} of {board.vehicles.length} vehicles have trips · {data.trips.length} trips · {stopsCount} stops
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {blockedCount > 0 && (
            <span className="hatch-violation inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-semibold">
              <Ban className="size-3.5" /> {blockedCount} blocked drop{blockedCount === 1 ? "" : "s"}
            </span>
          )}
          {nearBudget.length > 0 && (
            <span className="inline-flex h-8 items-center rounded-md border border-late-risk-border bg-late-risk-bg px-2.5 text-[13px] font-semibold text-late-risk">
              {nearBudget.length} vehicle{nearBudget.length === 1 ? "" : "s"} ≥ 95% of 270 min
            </span>
          )}
          <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-deferred-border bg-deferred-bg px-2.5 text-[13px] font-semibold text-deferred">
            <SkipForward className="size-3.5" /> {data.deferrals.length} deferred
          </span>
          <Button asChild size="desk" variant="secondary">
            <Link href="/dispatch/deferrals">Review deferrals</Link>
          </Button>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-[240px_minmax(0,1fr)_320px]">
        {/* ── deferred column (drop here to defer) */}
        <aside
          className={cn("border-r p-4", dragging && !deferredIds.has(dragging) && "bg-deferred-bg/40 outline-2 -outline-offset-4 outline-dashed outline-deferred-border")}
          onDragOver={(e) => {
            if (dragging && !deferredIds.has(dragging)) e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            const id = e.dataTransfer.getData("text/plain");
            setDragging(null);
            if (id && !deferredIds.has(id)) setDeferFor(id);
          }}
          aria-label="Deferred orders"
        >
          <h2 className="font-semibold">
            {data.planStatus === "published" ? "Deferred" : "Deferred in draft"} · {data.deferrals.length}
          </h2>
          <p className="mb-3 text-[13px] text-muted-foreground">Drag onto a trip; the board checks it as you move. Drop a stop here to defer it.</p>
          <ul className="space-y-2">
            {data.deferrals.map((d) => {
              const o = board.orders.get(d.orderId);
              if (!o) return null;
              const on = selection?.kind === "order" && selection.orderId === d.orderId;
              return (
                <li key={d.orderId}>
                  <button
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", d.orderId);
                      e.dataTransfer.effectAllowed = "move";
                      setDragging(d.orderId);
                      verdictCache.current.clear();
                    }}
                    onDragEnd={() => setDragging(null)}
                    onClick={() => setSelection({ kind: "order", orderId: d.orderId })}
                    className={cn(
                      "w-full cursor-grab rounded-md border bg-card p-2.5 text-left transition-colors hover:bg-muted active:cursor-grabbing",
                      on && "border-foreground",
                    )}
                  >
                    <div className="flex items-center gap-1.5 text-sm">
                      {o.temp === "chilled" && <Snowflake className="size-3.5 shrink-0 text-chilled" aria-label="chilled" />}
                      <span className="num font-semibold">{o.outletId}</span>
                      <span className="truncate text-muted-foreground">{o.outlet.district}</span>
                      <span className={cn("ml-auto text-[12px] font-semibold", KIND_STYLE[d.kind])}>{KIND_LABEL[d.kind]}</span>
                    </div>
                    <p className="num mt-0.5 text-[12px] text-muted-foreground">
                      {fmtKg(o.kg)} · {hhmm(o.outlet.open)}–{hhmm(o.outlet.close)}
                    </p>
                  </button>
                </li>
              );
            })}
            {data.deferrals.length === 0 && <li className="text-sm text-muted-foreground">Every order is on a trip.</li>}
          </ul>
        </aside>

        {/* ── lanes */}
        <div className="min-w-0 overflow-x-auto px-4 py-3">
          <table className="w-full min-w-[680px] table-fixed text-sm">
            <colgroup>
              <col className="w-[170px]" />
              <col />
              <col />
              <col className="w-[132px]" />
            </colgroup>
            <thead className="text-left text-[13px] text-muted-foreground">
              <tr>
                <th className="py-2 pr-2 font-medium">Vehicle</th>
                <th className="px-1 py-2 font-medium">Trip 1 · kg %</th>
                <th className="px-1 py-2 font-medium">Trip 2 · kg %</th>
                <th className="py-2 pl-2 font-medium">Fresh min / 270</th>
              </tr>
            </thead>
            {groups.map((g) => {
              const vs = board.vehicles.filter((v) => g.test(v) && match(v.id));
              if (!vs.length) return null;
              const withTrips = vs.filter((v) => tripsByVehicle.has(v.id)).length;
              return (
                <tbody key={g.title}>
                  <tr>
                    <th colSpan={4} className="num pt-3 pb-1 text-left text-[12px] font-semibold tracking-wider text-muted-foreground uppercase">
                      {g.title} · {withTrips} of {vs.length} with trips
                    </th>
                  </tr>
                  {vs.map((v) => {
                    const trips = tripsByVehicle.get(v.id) ?? [];
                    const inWorkshop = data.status[v.id] !== "available";
                    const mins = board.minutes(v.id);
                    const rowOn = selection?.kind === "trip" && selection.vehicleId === v.id;
                    return (
                      <tr key={v.id} className={cn("border-t", rowOn && "bg-accent/60", inWorkshop && "opacity-60")}>
                        <td className="truncate py-1.5 pr-2 whitespace-nowrap">
                          <span className="num font-semibold">{v.id}</span>{" "}
                          {v.temp === "reefer" && <Snowflake className="inline size-3.5 text-chilled" aria-label="reefer" />}{" "}
                          <span className="text-[12px] text-muted-foreground">
                            {v.type} {v.capKg.toLocaleString("en-US")} kg
                          </span>
                          {inWorkshop && <span className="ml-1.5 rounded-sm border px-1 text-[11px]">In workshop</span>}
                        </td>
                        {[1, 2].map((n) => {
                          const tr = trips[n - 1];
                          const target: Target = { vehicleId: v.id, tripNo: tr ? n : "new" };
                          const key = `${v.id}|${n}`;
                          const hv = hover?.key === key ? hover.verdict : null;
                          const canAdd = !!tr || trips.length === n - 1;
                          return (
                            <td
                              key={n}
                              className="px-1 py-1"
                              onDragOver={(e) => {
                                if (!dragging || inWorkshop || !canAdd) return;
                                e.preventDefault();
                                if (hover?.key !== key) setHover({ key, verdict: verdictFor(dragging, target) });
                              }}
                              onDragLeave={() => hover?.key === key && setHover(null)}
                              onDrop={(e) => {
                                e.preventDefault();
                                const id = e.dataTransfer.getData("text/plain");
                                if (id) drop(id, target, e);
                              }}
                            >
                              {tr ? (
                                <TripCell
                                  trip={tr}
                                  board={board}
                                  selected={rowOn && selection?.kind === "trip" && selection.tripNo === n}
                                  verdict={hv}
                                  onSelect={() => setSelection({ kind: "trip", vehicleId: v.id, tripNo: n })}
                                />
                              ) : (
                                <div
                                  className={cn(
                                    "flex h-9 items-center rounded-md px-2 text-muted-foreground",
                                    hv?.ok && "border border-dashed border-delivered-border bg-delivered-bg text-delivered",
                                    hv && !hv.ok && "hatch-violation",
                                  )}
                                >
                                  {hv ? (hv.ok ? "Drop: new trip" : `Can't: ${hv.title}`) : inWorkshop && n === 1 ? "—" : "—"}
                                </div>
                              )}
                            </td>
                          );
                        })}
                        <td className="py-1 pl-2">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                              <div
                                className={cn("h-full rounded-full", mins.Fresh > 270 * 0.95 ? "bg-late-risk" : "bg-foreground")}
                                style={{ width: `${Math.min(mins.Fresh / 270, 1) * 100}%` }}
                              />
                            </div>
                            <span className={cn("num", mins.Fresh > 270 * 0.95 && "text-late-risk")}>{mins.Fresh}</span>
                            {mins.Day > 0 && <span className="num text-[12px] text-muted-foreground">Day {mins.Day}/480</span>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              );
            })}
          </table>
        </div>

        {/* ── right panel */}
        <aside className="border-l p-4">
          {selection?.kind === "trip" ? (
            <TripPanel
              board={board}
              trip={(tripsByVehicle.get(selection.vehicleId) ?? [])[selection.tripNo - 1]}
              deferrals={data.deferrals.map((d) => d.orderId)}
              onDragStart={(id) => {
                setDragging(id);
                verdictCache.current.clear();
              }}
              onDragEnd={() => setDragging(null)}
              onMove={setMoveFor}
              onDefer={setDeferFor}
            />
          ) : selection?.kind === "order" ? (
            <OrderPanel
              board={board}
              deferral={data.deferrals.find((d) => d.orderId === selection.orderId)}
              orderId={selection.orderId}
              pending={pending}
              onServe={(t) => send({ kind: "trip", orderId: selection.orderId, vehicleId: t.vehicleId, tripNo: String(t.tripNo) })}
              onMove={() => setMoveFor(selection.orderId)}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Select a trip or a deferred order.</p>
          )}
        </aside>
      </div>

      {blocked && (
        <BlockedPopover
          blocked={blocked}
          board={board}
          onCancel={() => setBlocked(null)}
          onDrop={(t) => {
            setBlocked(null);
            send({ kind: "trip", orderId: blocked.orderId, vehicleId: t.vehicleId, tripNo: String(t.tripNo) });
          }}
          onOverride={(why) => {
            const b = blocked;
            setBlocked(null);
            send({ kind: "trip", orderId: b.orderId, vehicleId: b.target.vehicleId, tripNo: String(b.target.tripNo), override: why });
          }}
        />
      )}
      <DeferDialog
        orderId={deferFor}
        board={board}
        onClose={() => setDeferFor(null)}
        onConfirm={(justification) => {
          const id = deferFor!;
          setDeferFor(null);
          send({ kind: "defer", orderId: id, justification });
        }}
      />
      <MoveDialog
        key={moveFor ?? "closed"}
        orderId={moveFor}
        board={board}
        verdictFor={verdictFor}
        onClose={() => setMoveFor(null)}
        onPick={(t) => {
          const id = moveFor!;
          setMoveFor(null);
          send({ kind: "trip", orderId: id, vehicleId: t.vehicleId, tripNo: String(t.tripNo) });
        }}
        onOverride={(t, why) => {
          const id = moveFor!;
          setMoveFor(null);
          send({ kind: "trip", orderId: id, vehicleId: t.vehicleId, tripNo: String(t.tripNo), override: why });
        }}
      />
    </div>
  );
}

function TripCell({ trip, board, selected, verdict, onSelect }: { trip: BoardTrip; board: Board; selected: boolean; verdict: Verdict | null; onSelect: () => void }) {
  const orders = trip.orderIds.map((id) => board.orders.get(id)!).filter(Boolean);
  const f = orders[0];
  const v = board.R.vehicles.get(trip.vehicleId)!;
  const kgSum = orders.reduce((s, o) => s + o.kg, 0);
  if (!f) return null;
  return (
    <button
      onClick={onSelect}
      className={cn(
        "flex h-9 w-full items-center gap-1.5 rounded-md border bg-card px-2 text-left transition-colors hover:bg-muted",
        selected && "border-foreground ring-1 ring-foreground",
        verdict?.ok && "border-delivered-border bg-delivered-bg",
        verdict && !verdict.ok && "hatch-violation",
      )}
      title={verdict && !verdict.ok ? verdict.detail : `${trip.code} · departs ${hhmm(trip.departureMin)}`}
    >
      <BrandMark brand={f.outlet.brand} size={16} />
      <span className="num text-[12px] font-semibold">{trip.code}</span>
      <span className="min-w-0 truncate">{f.outlet.district}</span>
      <span className="text-[12px] text-muted-foreground">{orders.length} st</span>
      {orders.some((o) => o.outlet.parking === "van_only") && <span className="num rounded-sm border px-1 text-[10px]">van_only</span>}
      <span className="num ml-auto text-[12px] text-muted-foreground">{verdict && !verdict.ok ? verdict.title : `${Math.round((kgSum / v.capKg) * 100)}%`}</span>
    </button>
  );
}

function TripPanel({
  board,
  trip,
  deferrals,
  onDragStart,
  onDragEnd,
  onMove,
  onDefer,
}: {
  board: Board;
  trip: BoardTrip | undefined;
  deferrals: string[];
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onMove: (id: string) => void;
  onDefer: (id: string) => void;
}) {
  if (!trip) return <p className="text-sm text-muted-foreground">This trip no longer exists. Select another.</p>;
  const v = board.R.vehicles.get(trip.vehicleId)!;
  const orders = trip.orderIds.map((id) => board.orders.get(id)!).filter(Boolean);
  const f = orders[0]!;
  const d = board.R.districts.get(f.outlet.district)!;
  const kgSum = orders.reduce((s, o) => s + o.kg, 0);
  const m3Sum = orders.reduce((s, o) => s + o.m3, 0);
  const chilled = orders.filter((o) => o.temp === "chilled").length;
  const vanOnly = orders.filter((o) => o.outlet.parking === "van_only").length;
  const handling = orders.reduce((s, o) => s + board.R.allowance(o.outlet.brand, o.outlet.dock), 0);
  const tMin = tripMinutes(board.R, f.outlet.brand, f.outlet.district, orders.map((o) => o.outlet.dock));
  const mins = board.minutes(v.id);
  const isFresh = f.outlet.brand === "Fresh";
  const used = isFresh ? mins.Fresh : mins.Day;
  const budget = isFresh ? 270 : 480;
  const nTrips = (board.day.get(v.id) ?? []).length;
  const arrivals = orders.map((o) => ({ o, at: trip.arrivals[o.ref] ?? 0 }));
  const onTime = arrivals.filter((a) => a.at <= a.o.outlet.close).length;
  const fits = deferrals.filter((id) => board.check(id, { vehicleId: v.id, tripNo: trip.tripNo }).ok);
  const rules = [
    { ok: orders.every((o) => o.outlet.brand === f.outlet.brand && o.outlet.district === f.outlet.district), t: "1 · Brand and district", d: `${f.outlet.brand} only · ${f.outlet.district} only` },
    { ok: chilled === 0 || v.temp === "reefer", t: "2 · Refrigeration", d: `${chilled} chilled order${chilled === 1 ? "" : "s"} · ${v.id} is ${v.temp}` },
    { ok: vanOnly === 0 || v.type === "van", t: "3 · Access", d: vanOnly ? `${vanOnly} van_only outlet${vanOnly === 1 ? "" : "s"} · ${v.id} is a ${v.type}` : "No van_only outlets on this trip" },
    { ok: orders.every((o) => o.outlet.depot === v.depot), t: "4 · Home depot", d: `${v.id} and all ${orders.length} outlets: ${v.depot}` },
    { ok: true, t: "5 · Whole orders", d: `${orders.length} of ${orders.length} orders on one trip` },
    { ok: kgSum <= v.capKg && m3Sum <= v.capM3, t: "6 · Capacity", d: `${Math.round((kgSum / v.capKg) * 100)}% weight · ${Math.round((m3Sum / v.capM3) * 100)}% volume` },
    { ok: nTrips <= 2 && used <= budget, t: "7 · Trips and time", d: `Trip ${trip.tripNo} of ${nTrips} · ${used} of ${budget} ${isFresh ? "Fresh" : "day"} min` },
    { ok: onTime === orders.length, t: "+ Delivery windows", d: `${onTime} of ${orders.length} arrive before close` },
  ];
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <BrandMark brand={f.outlet.brand} size={22} />
          <h2 className="num text-lg font-semibold">{trip.code}</h2>
          {chilled > 0 && <TempTag temp="chilled" className="ml-auto" />}
        </div>
        <p className="text-[13px] text-muted-foreground">
          {v.id} · {v.temp} {v.type} · {f.outlet.district} · dep {hhmm(trip.departureMin)}
        </p>
      </div>
      <div>
        <h3 className="num mb-2 text-[12px] tracking-widest text-muted-foreground uppercase">
          Feasibility · {rules.filter((r) => r.ok).length} of {rules.length} pass
        </h3>
        <ul className="space-y-2">
          {rules.map((r) => (
            <li key={r.t} className="flex gap-2 text-sm">
              {r.ok ? <Check className="mt-0.5 size-4 shrink-0" /> : <Ban className="mt-0.5 size-4 shrink-0 text-violation" />}
              <div>
                <p className="font-medium">{r.t}</p>
                <p className="text-[13px] text-muted-foreground">{r.d}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="space-y-3">
        <Meter label="Weight" used={kgSum} total={v.capKg} valueLabel={`${kgSum.toFixed(1)} / ${v.capKg.toLocaleString("en-US")} kg`} />
        <Meter label="Volume" used={m3Sum} total={v.capM3} valueLabel={`${m3Sum.toFixed(2)} / ${v.capM3} m³`} />
        <Meter label={isFresh ? "Fresh minutes" : "Day minutes"} used={used} total={budget} />
        <p className="num text-[12px] text-muted-foreground">
          {d.outboundMin} travel + {orders.length - 1} × {d.interStopMin} inter-stop + {handling} handling = {tMin}
        </p>
      </div>
      <div>
        <h3 className="mb-1 text-sm font-semibold">Stops in driving order</h3>
        <ol className="space-y-1">
          {arrivals.map(({ o, at }, i) => (
            <li
              key={o.ref}
              draggable={trip.status === "planned"}
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", o.ref);
                onDragStart(o.ref);
              }}
              onDragEnd={onDragEnd}
              className="group flex items-center gap-1.5 rounded-md border bg-card px-2 py-1.5 text-sm"
            >
              <GripVertical className="size-3.5 cursor-grab text-muted-foreground" aria-hidden />
              <span className="num w-4 text-muted-foreground">{i + 1}</span>
              <span className="num font-semibold">{o.outletId}</span>
              {o.temp === "chilled" && <Snowflake className="size-3.5 text-chilled" aria-label="chilled" />}
              <span className={cn("num text-[12px]", at > o.outlet.close ? "text-violation" : "text-muted-foreground")}>{hhmm(at)}</span>
              <span className="ml-auto flex gap-1 opacity-70 group-hover:opacity-100">
                <button className="rounded px-1 text-[12px] underline-offset-2 hover:underline" onClick={() => onMove(o.ref)} aria-label={`Move ${o.ref}`}>
                  Move
                </button>
                <button className="rounded px-1 text-[12px] text-deferred underline-offset-2 hover:underline" onClick={() => onDefer(o.ref)} aria-label={`Defer ${o.ref}`}>
                  Defer
                </button>
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div className="rounded-lg border bg-card p-3 text-sm">
        <p className="font-semibold">
          Room left: {(v.capKg - kgSum).toFixed(1)} kg · {(v.capM3 - m3Sum).toFixed(1)} m³ · {budget - used} min
        </p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {fits.length ? `${fits.length} deferred order${fits.length === 1 ? "" : "s"} would fit here: ${fits.slice(0, 4).map((id) => board.orders.get(id)?.outletId).join(", ")}.` : "No deferred order fits on this trip."}
        </p>
        <Link href="/dispatch/deferrals" className="mt-1 inline-block text-[13px] font-medium underline underline-offset-4">
          See it in deferral review
        </Link>
      </div>
    </div>
  );
}

function OrderPanel({
  board,
  deferral,
  orderId,
  pending,
  onServe,
  onMove,
}: {
  board: Board;
  deferral: BoardData["deferrals"][number] | undefined;
  orderId: string;
  pending: boolean;
  onServe: (t: Target) => void;
  onMove: () => void;
}) {
  const o = board.orders.get(orderId);
  if (!o) return null;
  const slots = board.legalSlots(orderId, 4);
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <BrandMark brand={o.outlet.brand} size={22} />
          <h2 className="num text-lg font-semibold">{o.outletId}</h2>
          <TempTag temp={o.temp} className="ml-auto" />
        </div>
        <p className="num text-[13px] text-muted-foreground">
          {o.ref} · {o.outlet.district} · {fmtKg(o.kg)} · {o.m3.toFixed(2)} m³ · {hhmm(o.outlet.open)}–{hhmm(o.outlet.close)}
        </p>
      </div>
      {deferral && (
        <div className="rounded-lg border border-deferred-border bg-deferred-bg p-3 text-sm">
          <p className={cn("font-semibold", KIND_STYLE[deferral.kind])}>{KIND_LABEL[deferral.kind]} deferral</p>
          <p className="mt-1">{deferral.explanation}</p>
        </div>
      )}
      <div>
        <h3 className="mb-2 text-sm font-semibold">Legal slots</h3>
        {slots.length ? (
          <ul className="space-y-2">
            {slots.map((s) => (
              <li key={`${s.vehicleId}${s.tripNo}`} className="flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-2 text-sm">
                <span className="num">{s.label}</span>
                <Button size="sm" variant="secondary" disabled={pending} onClick={() => onServe(s)}>
                  Serve here
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted-foreground">No vehicle can legally take it today without removing another order.</p>
        )}
      </div>
      <Button variant="outline" size="desk" className="w-full" onClick={onMove}>
        <MoveRight /> Move to…
      </Button>
    </div>
  );
}

function BlockedPopover({
  blocked,
  board,
  onCancel,
  onDrop,
  onOverride,
}: {
  blocked: Blocked;
  board: Board;
  onCancel: () => void;
  onDrop: (t: Target) => void;
  onOverride: (why: string) => void;
}) {
  const o = board.orders.get(blocked.orderId)!;
  const best = blocked.legal[0];
  const overridable = OVERRIDABLE_CODES.has(blocked.verdict.code ?? "");
  const [why, setWhy] = useState("");
  const [overriding, setOverriding] = useState(false);
  return (
    <div
      role="alertdialog"
      aria-label={`Can't drop: ${blocked.verdict.title}`}
      className="fixed z-50 w-[360px] rounded-lg border border-violation bg-popover p-4 shadow-xl"
      style={{ left: Math.min(blocked.x, (typeof window !== "undefined" ? window.innerWidth : 1440) - 380), top: Math.max(blocked.y - 150, 12) }}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
    >
      <p className="flex items-center gap-2 font-semibold text-violation">
        <Ban className="size-4" /> Can&apos;t drop · {blocked.verdict.title}
      </p>
      <p className="mt-2 text-sm">{blocked.verdict.detail}</p>
      {best ? (
        <p className="mt-2 text-[13px] text-muted-foreground">
          Legal slot for {o.outletId}: {best.label}.
        </p>
      ) : (
        <p className="mt-2 text-[13px] text-muted-foreground">No legal slot is free for {o.outletId} right now.</p>
      )}
      <div className="mt-3 flex gap-2">
        {best && (
          <Button size="desk" autoFocus onClick={() => onDrop(best)}>
            Drop on {best.vehicleId}
          </Button>
        )}
        <Button size="desk" variant="outline" onClick={onCancel}>
          <X /> Cancel (Esc)
        </Button>
      </div>
      {overridable && (
        <div className="mt-3 border-t pt-3">
          {overriding ? (
            <div className="space-y-2">
              <p className="text-[13px] text-muted-foreground">
                Timing and fuel rules can be overridden when you know something the plan does not (the store agreed to a late delivery, fuel was topped
                up). Your reason is recorded and shown at publish. Vehicle type, weight and one brand per trip can never be overridden.
              </p>
              <Textarea rows={2} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. OUT041 agreed by phone to receive until 08:30" autoFocus />
              <Button size="desk" variant="destructive" disabled={why.trim().length < 10} onClick={() => onOverride(why.trim())}>
                Override and move to {blocked.target.vehicleId}
              </Button>
            </div>
          ) : (
            <button className="text-[13px] underline underline-offset-4" onClick={() => setOverriding(true)}>
              Override this rule with a reason…
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DeferDialog({ orderId, board, onClose, onConfirm }: { orderId: string | null; board: Board; onClose: () => void; onConfirm: (why: string) => void }) {
  const [why, setWhy] = useState("");
  const o = orderId ? board.orders.get(orderId) : null;
  return (
    <Dialog open={!!orderId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Defer {o?.outletId} to the next run?</DialogTitle>
          <DialogDescription>
            A manual deferral is recorded with your reason and shown to the store. The outlet gets priority on the next run, so it cannot be skipped twice.
          </DialogDescription>
        </DialogHeader>
        <Textarea value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Reason, e.g. store closed for stock-take until 10:00" rows={3} autoFocus />
        <DialogFooter>
          <Button variant="outline" size="desk" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="desk"
            disabled={why.trim().length < 5}
            onClick={() => {
              onConfirm(why.trim());
              setWhy("");
            }}
          >
            Defer with reason
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MoveDialog({
  orderId,
  board,
  verdictFor,
  onClose,
  onPick,
  onOverride,
}: {
  orderId: string | null;
  board: Board;
  verdictFor: (o: string, t: Target) => Verdict;
  onClose: () => void;
  onPick: (t: Target) => void;
  onOverride: (t: Target, why: string) => void;
}) {
  const o = orderId ? board.orders.get(orderId) : null;
  const [pick, setPick] = useState<(Target & { label: string; v: Verdict }) | null>(null);
  const [why, setWhy] = useState("");
  const options: Array<Target & { label: string; v: Verdict }> = [];
  if (orderId && o) {
    for (const v of board.vehicles) {
      if (v.depot !== o.outlet.depot) continue;
      const ts = board.day.get(v.id) ?? [];
      ts.forEach((t, i) => options.push({ vehicleId: v.id, tripNo: i + 1, label: `${v.id} trip ${i + 1} · ${t[0]?.outlet.brand} ${t[0]?.outlet.district}`, v: verdictFor(orderId, { vehicleId: v.id, tripNo: i + 1 }) }));
      if (ts.length < 2) options.push({ vehicleId: v.id, tripNo: "new", label: `${v.id} · new trip`, v: verdictFor(orderId, { vehicleId: v.id, tripNo: "new" }) });
    }
  }
  const ok = options.filter((x) => x.v.ok);
  const no = options.filter((x) => !x.v.ok && x.v.code !== "SAME");
  return (
    <Dialog open={!!orderId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Move {o?.outletId} ({o?.ref})</DialogTitle>
          <DialogDescription>Every option is checked against rules 1–7, delivery windows and fuel. Timing and fuel overruns can be overridden with a reason; vehicle type, weight and one brand per trip never can.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] space-y-1 overflow-y-auto">
          {ok.map((x) => (
            <button
              key={`${x.vehicleId}${x.tripNo}`}
              onClick={() => onPick(x)}
              className="flex w-full items-center justify-between rounded-md border bg-card px-3 py-2 text-left text-sm hover:bg-muted"
            >
              <span className="num">{x.label}</span>
              <span className="text-[12px] font-semibold text-delivered">Fits</span>
            </button>
          ))}
          {no.slice(0, 12).map((x) =>
            OVERRIDABLE_CODES.has(x.v.code ?? "") ? (
              <button
                key={`${x.vehicleId}${x.tripNo}`}
                onClick={() => setPick(x)}
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted",
                  pick?.vehicleId === x.vehicleId && pick.tripNo === x.tripNo && "bg-muted",
                )}
              >
                <span className="num">{x.label}</span>
                <span className="text-[12px] text-violation">{x.v.title} · override…</span>
              </button>
            ) : (
              <div key={`${x.vehicleId}${x.tripNo}`} className="flex items-center justify-between rounded-md px-3 py-1.5 text-sm text-muted-foreground">
                <span className="num">{x.label}</span>
                <span className="text-[12px] text-violation">{x.v.title}</span>
              </div>
            ),
          )}
        </div>
        {pick && (
          <div className="space-y-2 border-t pt-3">
            <p className="text-sm">
              Override <strong>{pick.v.title.toLowerCase()}</strong> on {pick.label}? Your reason is recorded and shown at publish.
            </p>
            <Textarea rows={2} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. the store agreed by phone to receive until 08:30" autoFocus />
            <Button size="desk" variant="destructive" disabled={why.trim().length < 10} onClick={() => onOverride(pick, why.trim())}>
              Override and move
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
