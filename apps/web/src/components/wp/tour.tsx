"use client";

import { driver, type Driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import { CircleHelp } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Guided tours. Each screen declares its steps with <PageTour>; a step points at an element marked
 * `data-tour="<el>"` (or is a centred card when `el` is omitted). The first visit to a screen starts
 * its tour once; the help button in every role's header replays it. A step whose element is not on
 * screen right now (no plan yet, nothing late) is skipped, so a tour never points at nothing.
 */
export interface TourStep {
  /** `data-tour` value of the element to highlight; omit for a centred card */
  el?: string;
  title: string;
  body: string;
  side?: "top" | "right" | "bottom" | "left";
}

const SEEN = (id: string) => `wp-tour:${id}:v1`;
const PREFIX = "wp-tour:";

// The current screen's tour, so the header help button can replay it.
let current: { id: string; start: () => void } | null = null;
const listeners = new Set<() => void>();
const setCurrent = (c: typeof current) => {
  current = c;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function seen(id: string) {
  try {
    return localStorage.getItem(SEEN(id)) === "1";
  } catch {
    return true; // storage blocked: never auto-start, the help button still works
  }
}
function markSeen(id: string) {
  try {
    localStorage.setItem(SEEN(id), "1");
  } catch {
    /* storage blocked */
  }
}

/** Forget every tour this browser has seen (demo panel → "Show the guided tours again"). */
export function resetTours() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    /* storage blocked */
  }
}

const visible = (el: Element | null): el is HTMLElement => !!el && el instanceof HTMLElement && el.getClientRects().length > 0;
const find = (el: string) => document.querySelector(`[data-tour="${el}"]`);

/** Markers every screen of a role has (header, rail). A tour only auto-starts once its own content is on screen. */
const CHROME = new Set(["help", "bell", "rail", "depot", "clock"]);
const hasContent = (steps: TourStep[]) => {
  const own = steps.filter((s) => s.el && !CHROME.has(s.el));
  return own.length === 0 || own.some((s) => visible(find(s.el!)));
};

export function PageTour({ id, steps, large = false, autoStart = true }: { id: string; steps: TourStep[]; large?: boolean; autoStart?: boolean }) {
  const drv = useRef<Driver | null>(null);
  const stepsRef = useRef(steps);
  useEffect(() => {
    stepsRef.current = steps;
  });

  useEffect(() => {
    const start = () => {
      drv.current?.destroy();
      const live: DriveStep[] = stepsRef.current.flatMap((s) => {
        if (!s.el) return [{ popover: { title: s.title, description: s.body } }];
        const node = find(s.el);
        return visible(node) ? [{ element: node, popover: { title: s.title, description: s.body, side: s.side, align: "start" as const } }] : [];
      });
      if (!live.length) return;
      const d = driver({
        steps: live,
        showProgress: live.length > 1,
        progressText: "{{current}} of {{total}}",
        nextBtnText: "Next",
        prevBtnText: "Back",
        doneBtnText: "Got it",
        allowClose: true,
        overlayOpacity: 0.55,
        stagePadding: 6,
        stageRadius: 10,
        smoothScroll: true,
        popoverClass: cn("wp-tour", large && "wp-tour-lg"),
        onDestroyed: () => markSeen(id),
      });
      drv.current = d;
      d.drive();
    };
    setCurrent({ id, start });
    // let the screen settle (data, fonts, layout) before measuring; an empty screen (no plan yet,
    // no conflicts) waits, so its tour runs the first time there is something to explain
    const timer = autoStart && !seen(id) ? window.setTimeout(() => hasContent(stepsRef.current) && start(), 700) : undefined;
    return () => {
      window.clearTimeout(timer);
      drv.current?.destroy();
      drv.current = null;
      if (current?.id === id) setCurrent(null);
    };
  }, [id, autoStart, large]);

  return null;
}

/** Header button: replays the guided tour of the screen you are on. Hidden when the screen has none. */
export function TourButton({ className, label = "How this screen works" }: { className?: string; label?: string }) {
  const tour = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  if (!tour) return null;
  return (
    <Button variant="ghost" size="icon" className={cn("shrink-0", className)} onClick={() => tour.start()} aria-label={label} title={label}>
      <CircleHelp className="size-5" />
    </Button>
  );
}

/** Demo panel: forget which tours this browser has seen, so each screen explains itself again. */
export function ReplayToursButton() {
  return (
    <Button
      variant="outline"
      size="desk"
      onClick={() => {
        resetTours();
        toast.success("Guided tours reset - each screen shows its tour again on your next visit.");
      }}
    >
      <CircleHelp /> Show the guided tours again
    </Button>
  );
}
