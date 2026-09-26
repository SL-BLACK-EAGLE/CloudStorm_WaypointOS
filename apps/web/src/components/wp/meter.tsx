import { cn } from "@/lib/utils";

/**
 * Budget / capacity meter (DS-01 Progress): the fill turns late-risk above 95% of the budget;
 * above 100% it becomes a hatched violation and publishing is blocked.
 */
export function Meter({
  used,
  total,
  label,
  valueLabel,
  className,
  tone = "auto",
}: {
  used: number;
  total: number;
  label?: React.ReactNode;
  valueLabel?: React.ReactNode;
  className?: string;
  tone?: "auto" | "neutral";
}) {
  const ratio = total > 0 ? used / total : 0;
  const pct = Math.min(ratio, 1) * 100;
  const state = tone === "neutral" ? "ok" : ratio > 1 ? "over" : ratio > 0.95 ? "risk" : "ok";
  return (
    <div className={cn("space-y-1.5", className)}>
      {(label || valueLabel) && (
        <div className="flex items-baseline justify-between gap-3 text-[13px]">
          <span className="text-muted-foreground">{label}</span>
          <span className={cn("num font-medium", state === "over" && "text-violation", state === "risk" && "text-late-risk")}>
            {valueLabel ?? `${Math.round(used)} / ${Math.round(total)}`}
          </span>
        </div>
      )}
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={used}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width]",
            state === "ok" && "bg-foreground",
            state === "risk" && "bg-late-risk",
            state === "over" && "hatch-violation border-0",
          )}
          style={{ width: `${state === "over" ? 100 : pct}%` }}
        />
      </div>
    </div>
  );
}
