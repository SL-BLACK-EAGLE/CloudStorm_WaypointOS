import { cn } from "@/lib/utils";

/** The bordered surface used across dispatcher boards (DS-01 Card: lg radius, 1 px border). */
export function Panel({ className, ...props }: React.ComponentProps<"section">) {
  return <section className={cn("rounded-lg border bg-card text-card-foreground", className)} {...props} />;
}

export function PanelHeader({ title, aside, className }: { title: React.ReactNode; aside?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 border-b px-4 py-3", className)}>
      <h2 className="font-semibold">{title}</h2>
      {aside && <div className="text-[13px] text-muted-foreground">{aside}</div>}
    </div>
  );
}

/** KPI tile: label, big mono value, one line of context. */
export function Kpi({
  label,
  value,
  sub,
  tone,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "deferred" | "late-risk" | "violation";
  className?: string;
}) {
  return (
    <Panel className={cn("p-4", tone === "deferred" && "border-deferred-border", className)}>
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          "num mt-1 text-3xl font-semibold tracking-tight",
          tone === "deferred" && "text-deferred",
          tone === "late-risk" && "text-late-risk",
          tone === "violation" && "text-violation",
        )}
      >
        {value}
      </p>
      {sub && <div className="mt-1 text-[13px] text-muted-foreground">{sub}</div>}
    </Panel>
  );
}
