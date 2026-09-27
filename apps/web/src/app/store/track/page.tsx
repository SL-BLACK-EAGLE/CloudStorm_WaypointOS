import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { TempTag } from "@/components/wp/chips";
import { Panel } from "@/components/wp/panel";
import { addDaysIso } from "@/lib/server/clock";
import { dayLabel, hhmm, kg } from "@/lib/format";
import { runs } from "@/lib/server/runs";
import { requireUser } from "@/lib/server/session";
import { storeOrders } from "@/lib/server/store";
import { StagePill } from "../stage-pill";

export const metadata: Metadata = { title: "Track orders" };

/** Track tab: every order from the last week and the coming runs, newest first. */
export default async function TrackPage() {
  const user = await requireUser(["store_manager"]);
  const { active } = await runs();
  const orders = await storeOrders(user.outletId!, addDaysIso(active, -7), addDaysIso(active, 7));
  const byDate = new Map<string, typeof orders>();
  for (const o of orders) byDate.set(o.runDate, [...(byDate.get(o.runDate) ?? []), o]);
  return (
    <main className="space-y-4">
      <h1 className="text-xl font-semibold">Your orders</h1>
      {[...byDate].map(([date, os]) => (
        <Panel key={date}>
          <h2 className="border-b px-4 py-2.5 text-sm font-semibold">{dayLabel(date, true)}</h2>
          <ul className="divide-y">
            {os.map((o) => (
              <li key={o.id}>
                <Link href={`/store/orders/${o.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
                  <TempTag temp={o.temp} />
                  <span className="min-w-0 flex-1">
                    <span className="num block text-sm font-medium">{o.id}</span>
                    <span className="num block text-[13px] text-muted-foreground">
                      {o.units} units · {kg(o.weightKg)}
                      {o.stop
                        ? ` · ${o.stop.status === "delivered" ? `delivered ${hhmm(o.stop.leftMin)}` : `around ${hhmm(o.stop.etaMin ?? o.stop.plannedArrive)}`}`
                        : ""}
                    </span>
                  </span>
                  <StagePill order={o} />
                  <ChevronRight className="size-4 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      ))}
      {orders.length === 0 && <p className="text-sm text-muted-foreground">No orders in this period.</p>}
    </main>
  );
}
