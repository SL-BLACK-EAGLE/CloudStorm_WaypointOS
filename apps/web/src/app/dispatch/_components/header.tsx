import { dayLabel, hhmm } from "@/lib/format";
import { NotificationBell } from "@/components/wp/notification-bell";
import { now } from "@/lib/server/clock";
import { cn } from "@/lib/utils";
import { setDepot } from "../actions";
import type { DepotId } from "../depot";

/** D-01..D-07 page header: title, one line of context, depot switch and the business clock. */
export async function DispatchHeader({
  title,
  context,
  depot,
  actions,
}: {
  title: string;
  context?: React.ReactNode;
  depot?: DepotId;
  actions?: React.ReactNode;
}) {
  const clock = await now();
  return (
    <header className="sticky top-0 z-20 flex min-h-16 print:hidden flex-wrap items-center gap-x-4 gap-y-2 border-b bg-background/95 px-6 py-3 backdrop-blur">
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {context && <p className="text-sm text-muted-foreground">{context}</p>}
      </div>
      {actions}
      {depot && (
        <form action={setDepot} className="flex rounded-lg border bg-card p-0.5" aria-label="Depot">
          {(["Peliyagoda", "Kandy"] as const).map((d) => (
            <button
              key={d}
              name="depot"
              value={d}
              aria-pressed={depot === d}
              className={cn(
                "h-8 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:text-foreground",
                depot === d && "bg-accent font-medium text-foreground",
              )}
            >
              {d}
            </button>
          ))}
        </form>
      )}
      <p className="num text-sm text-muted-foreground" title="Business clock (Asia/Colombo)">
        {dayLabel(clock.date)} · {hhmm(clock.minute)}
      </p>
      <NotificationBell channels={["role:dispatcher"]} />
    </header>
  );
}
