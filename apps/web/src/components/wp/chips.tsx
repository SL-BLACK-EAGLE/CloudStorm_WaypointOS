/**
 * Semantic chips from the style guide (DS-01 §02).
 * "Never color alone": every state has an icon, a word and a color. Shape tells the category:
 * status = pill, temperature = icon-led tag, brand = square monogram, violation = hatched outline.
 */
import {
  Ban,
  CircleCheck,
  CircleDashed,
  ClockAlert,
  GitMerge,
  ListChecks,
  OctagonAlert,
  Package,
  RefreshCw,
  SkipForward,
  Snowflake,
  Truck,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type StatusKind =
  | "planned"
  | "loading"
  | "en-route"
  | "delivered"
  | "deferred"
  | "late-risk"
  | "conflict"
  | "exception"
  | "offline"
  | "syncing";

const STATUS: Record<StatusKind, { icon: LucideIcon; label: string; cls: string }> = {
  planned: { icon: CircleDashed, label: "Planned", cls: "text-planned bg-planned-bg border-planned-border" },
  loading: { icon: ListChecks, label: "Loading", cls: "text-loading bg-loading-bg border-loading-border" },
  "en-route": { icon: Truck, label: "En route", cls: "text-en-route bg-en-route-bg border-en-route-border" },
  delivered: { icon: CircleCheck, label: "Delivered", cls: "text-delivered bg-delivered-bg border-delivered-border" },
  deferred: { icon: SkipForward, label: "Deferred", cls: "text-deferred bg-deferred-bg border-deferred-border" },
  "late-risk": { icon: ClockAlert, label: "Late risk", cls: "text-late-risk bg-late-risk-bg border-late-risk-border" },
  conflict: { icon: GitMerge, label: "Conflict", cls: "text-conflict bg-conflict-bg border-conflict-border" },
  exception: { icon: OctagonAlert, label: "Exception", cls: "text-exception bg-exception-bg border-exception-border" },
  offline: { icon: WifiOff, label: "Offline", cls: "text-offline bg-offline-bg border-offline-border border-dashed" },
  syncing: { icon: RefreshCw, label: "Syncing", cls: "text-syncing bg-syncing-bg border-syncing-border" },
};

export function StatusPill({
  status,
  children,
  size = "sm",
  className,
}: {
  status: StatusKind;
  children?: React.ReactNode;
  size?: "sm" | "lg";
  className?: string;
}) {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border font-semibold",
        size === "sm" ? "h-7 px-2.5 text-[13px]" : "h-10 px-4 text-base",
        s.cls,
        className,
      )}
    >
      <Icon className={size === "sm" ? "size-3.5" : "size-5"} aria-hidden />
      {children ?? s.label}
    </span>
  );
}

export function TempTag({ temp, size = "sm", className }: { temp: "chilled" | "ambient"; size?: "sm" | "lg"; className?: string }) {
  const chilled = temp === "chilled";
  const Icon = chilled ? Snowflake : Package;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border font-semibold",
        size === "sm" ? "h-7 px-2 text-[13px]" : "h-10 px-3 text-base",
        chilled ? "text-chilled bg-chilled-bg border-chilled-border" : "text-ambient bg-ambient-bg border-ambient-border",
        className,
      )}
    >
      <Icon className={size === "sm" ? "size-3.5" : "size-5"} aria-hidden />
      {chilled ? "Chilled" : "Ambient"}
    </span>
  );
}

const BRAND = {
  Fresh: "bg-brand-fresh text-brand-fresh-foreground",
  Style: "bg-brand-style text-brand-style-foreground",
  Tech: "bg-brand-tech text-brand-tech-foreground",
} as const;

export function BrandMark({ brand, size = 20, className }: { brand: keyof typeof BRAND; size?: number; className?: string }) {
  return (
    <span
      role="img"
      aria-label={`Waypoint ${brand}`}
      className={cn("inline-grid shrink-0 place-items-center rounded-sm font-bold leading-none", BRAND[brand], className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.6) }}
    >
      {brand[0]}
    </span>
  );
}

export function BrandTag({ brand, className }: { brand: keyof typeof BRAND; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm font-medium", className)}>
      <BrandMark brand={brand} size={18} />
      {brand}
    </span>
  );
}

export function ViolationChip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "hatch-violation inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm px-2.5 text-[13px] font-semibold",
        className,
      )}
    >
      <Ban className="size-3.5" aria-hidden />
      {children}
    </span>
  );
}

/** The "W" app mark used in every role's top-left corner. */
export function WMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-grid shrink-0 place-items-center rounded-md bg-primary font-bold text-primary-foreground", className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
    >
      W
    </span>
  );
}

/** IDs, times and quantities in Geist Mono with tabular figures. */
export function Num({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("num", className)}>{children}</span>;
}
