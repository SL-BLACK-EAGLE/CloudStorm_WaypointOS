"use client";

import { AlarmClock, ChevronDown, ChevronUp, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { hhmm } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SignalListener } from "./realtime";

interface Alert {
  tripId: string;
  code: string;
  vehicleId: string;
  district: string;
  departureMin: number;
  minutesTo: number;
  state: "due" | "late";
  held: boolean;
  stops: number;
  loaded: number;
  shortfalls: number;
}

const SHOWN = 3;

/**
 * Departure banner, top centre of every loader and dispatcher screen: vehicles due to leave within
 * 5 minutes, or already late, that the loader has not signed off. It reads the live list (so it is
 * right between cron runs), refreshes on realtime signals, and re-checks every 20 s because the
 * demo clock can run fast. Each minute late is also a notification in the bell (Convex cron).
 */
export function DepartureAlerts({ role, channels, className }: { role: "loader" | "dispatcher"; channels: string[]; className?: string }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [collapsedFor, setCollapsedFor] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/departure-alerts", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setAlerts(d.alerts))
      .catch(() => undefined); // offline: keep the last list
  }, []);
  useEffect(() => {
    const first = window.setTimeout(load, 0);
    const id = window.setInterval(() => document.visibilityState === "visible" && load(), 20_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [load]);

  // collapsing hides the list until something new needs attention (a new trip, or one turning late)
  const key = alerts.map((a) => `${a.tripId}:${a.state}`).join(",");
  const collapsed = collapsedFor === key;
  const late = alerts.filter((a) => a.state === "late").length;
  const linkFor = (a: Alert) => (role === "loader" ? `/dock/${a.tripId}` : `/dispatch/live?trip=${a.tripId}`);

  return (
    <>
      <SignalListener channels={channels} onChange={load} />
      {alerts.length > 0 && (
        <div
          role="status"
          aria-live="polite"
          className={cn("pointer-events-none fixed left-1/2 z-40 w-[min(560px,calc(100vw-16px))] -translate-x-1/2 print:hidden", className)}
        >
          {collapsed ? (
            <button
              onClick={() => setCollapsedFor(null)}
              className={cn(
                "pointer-events-auto mx-auto flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold shadow-lg",
                late ? "border-exception-border bg-exception-bg text-exception" : "border-late-risk-border bg-late-risk-bg text-late-risk",
              )}
            >
              <AlarmClock className="size-4" />
              {alerts.length} vehicle{alerts.length === 1 ? "" : "s"} not signed off{late ? ` · ${late} late` : ""}
              <ChevronDown className="size-4" />
            </button>
          ) : (
            <div className="pointer-events-auto overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-xl">
              <div className={cn("flex items-center gap-2 px-4 py-2 text-sm font-semibold", late ? "bg-exception-bg text-exception" : "bg-late-risk-bg text-late-risk")}>
                <AlarmClock className="size-4 shrink-0" />
                <span className="flex-1">
                  {late ? `${late} vehicle${late === 1 ? "" : "s"} late to leave` : "Departures due"} · sign off at the dock
                </span>
                <button onClick={() => setCollapsedFor(key)} className="rounded p-0.5 hover:bg-black/10" aria-label="Collapse departure alerts">
                  <ChevronUp className="size-4" />
                </button>
              </div>
              <ul className="divide-y">
                {alerts.slice(0, SHOWN).map((a) => (
                  <li key={a.tripId}>
                    <Link href={linkFor(a)} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted">
                      <TriangleAlert className={cn("size-5 shrink-0", a.state === "late" ? "text-exception sunlight:text-exception-bg" : "text-late-risk")} />
                      <span className="min-w-0 flex-1">
                        <span className="num block truncate font-semibold">
                          {a.vehicleId} · {a.code} → {a.district}
                        </span>
                        <span className="block truncate text-[13px] text-muted-foreground">
                          Planned {hhmm(a.departureMin)} · {a.loaded}/{a.stops} loaded
                          {a.shortfalls ? ` · ${a.shortfalls} shortfall${a.shortfalls === 1 ? "" : "s"}` : ""}
                          {a.held ? " · held by dispatcher" : " · not signed off"}
                        </span>
                      </span>
                      <span className={cn("num shrink-0 text-right text-base font-bold", a.state === "late" ? "text-exception sunlight:text-exception-bg" : "text-late-risk")}>
                        {a.state === "late" ? `${-a.minutesTo} min late` : a.minutesTo === 0 ? "leaves now" : `in ${a.minutesTo} min`}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              {alerts.length > SHOWN && (
                <Link href={role === "loader" ? "/dock" : "/dispatch/live"} className="block border-t px-4 py-2 text-center text-[13px] font-medium hover:bg-muted">
                  +{alerts.length - SHOWN} more
                </Link>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
