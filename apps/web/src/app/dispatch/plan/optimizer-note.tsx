import { Sparkles } from "lucide-react";

interface OptimizerMetrics {
  baseServed: number;
  served: number;
  baseTrips: number;
  trips: number;
  baseLitres: number;
  litres: number;
  moves: Array<{ kind: string; detail: string }>;
}

const KIND: Record<string, string> = {
  insert: "Fitted a deferred order",
  eject: "Made room",
  "free-slot": "Freed a capable vehicle",
  merge: "Merged trips",
};

/** D-03: what the improvement pass changed on top of the flowchart algorithm - every change listed and explained. */
export function OptimizerNote({ metrics }: { metrics: unknown }) {
  const o = (metrics as { optimizer?: OptimizerMetrics } | null)?.optimizer;
  if (!o) return null;
  const served = o.served - o.baseServed;
  const trips = o.trips - o.baseTrips;
  const litres = Math.round((o.litres - o.baseLitres) * 10) / 10;
  const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  return (
    <details className="group mx-6 mt-4 rounded-lg border bg-card text-sm">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
        <Sparkles className="size-4 text-muted-foreground" />
        <span className="font-medium">Improvement pass</span>
        {o.moves.length === 0 ? (
          <span className="text-muted-foreground">the flowchart plan was already the best it could find</span>
        ) : (
          <span className="num text-muted-foreground">
            {sign(served)} orders served · {sign(trips)} trips · {sign(litres)} L fuel · {o.moves.length} change{o.moves.length === 1 ? "" : "s"}, each re-checked
            against rules 1–7
          </span>
        )}
        {o.moves.length > 0 && <span className="ml-auto text-[13px] text-muted-foreground group-open:hidden">Show changes</span>}
      </summary>
      {o.moves.length > 0 && (
        <div className="border-t px-4 py-3">
          <p className="mb-2 text-[13px] text-muted-foreground">
            The flowchart algorithm (identical to the team&apos;s Python planner) served {o.baseServed} orders on {o.baseTrips} trips. The improvement pass
            kept every one of them and made these changes:
          </p>
          <ol className="list-decimal space-y-1 pl-5">
            {o.moves.map((m, i) => (
              <li key={i}>
                <span className="font-medium">{KIND[m.kind] ?? m.kind}:</span> {m.detail}
              </li>
            ))}
          </ol>
        </div>
      )}
    </details>
  );
}
