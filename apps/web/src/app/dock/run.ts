import "server-only";
import { publishedPlan, type DepotId } from "@/lib/server/planning";
import { runs } from "@/lib/server/runs";

/** The run the dock works on: the active run, or the next one if that is the only one published yet. */
export async function dockRun(depot: DepotId) {
  const r = await runs();
  if (await publishedPlan(depot, r.active)) return { ...r, runDate: r.active };
  if (await publishedPlan(depot, r.planning)) return { ...r, runDate: r.planning };
  return { ...r, runDate: r.active };
}
