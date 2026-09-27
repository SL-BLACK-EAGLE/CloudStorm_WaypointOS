import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { StatusPill, TempTag } from "@/components/wp/chips";
import { Panel } from "@/components/wp/panel";
import { addDaysIso } from "@/lib/server/clock";
import { dayLabel, hhmm } from "@/lib/format";
import { runs } from "@/lib/server/runs";
import { requireUser } from "@/lib/server/session";
import { storeOrders } from "@/lib/server/store";

export const metadata: Metadata = { title: "Receive" };

export default async function ReceiveListPage() {
  const user = await requireUser(["store_manager"]);
  const { active } = await runs();
  const orders = (await storeOrders(user.outletId!, addDaysIso(active, -3), addDaysIso(active, 1))).filter((o) => o.stop || o.status === "delivered");
  const toConfirm = orders.filter((o) => (o.status === "delivered" || o.stop?.status === "delivered") && !o.receipt);
  const onTheWay = orders.filter((o) => o.stop && o.stop.status !== "delivered" && o.status !== "delivered");
  const done = orders.filter((o) => o.receipt);
  const row = (o: (typeof orders)[number], right: React.ReactNode) => (
    <li key={o.id}>
      <Link href={`/store/receive/${o.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
        <TempTag temp={o.temp} />
        <span className="flex-1">
          <span className="num block text-sm font-medium">{o.id}</span>
          <span className="block text-[13px] text-muted-foreground">
            {dayLabel(o.runDate)} · {o.units} units
          </span>
        </span>
        {right}
        <ChevronRight className="size-4 text-muted-foreground" />
      </Link>
    </li>
  );
  return (
    <main className="space-y-4">
      <h1 className="text-xl font-semibold">Receive and confirm</h1>
      <Panel>
        <h2 className="border-b px-4 py-2.5 text-sm font-semibold">Delivered · confirm what arrived ({toConfirm.length})</h2>
        <ul className="divide-y">
          {toConfirm.map((o) => row(o, <StatusPill status="delivered">{`Delivered ${hhmm(o.stop?.leftMin ?? null)}`}</StatusPill>))}
          {toConfirm.length === 0 && <li className="px-4 py-4 text-sm text-muted-foreground">Nothing to confirm right now.</li>}
        </ul>
      </Panel>
      {onTheWay.length > 0 && (
        <Panel>
          <h2 className="border-b px-4 py-2.5 text-sm font-semibold">On the way</h2>
          <ul className="divide-y">
            {onTheWay.map((o) => row(o, <span className="num text-sm">around {hhmm(o.stop!.etaMin ?? o.stop!.plannedArrive)}</span>))}
          </ul>
        </Panel>
      )}
      {done.length > 0 && (
        <Panel>
          <h2 className="border-b px-4 py-2.5 text-sm font-semibold">Confirmed</h2>
          <ul className="divide-y">
            {done
              .slice(0, 10)
              .map((o) =>
                row(
                  o,
                  <StatusPill status={o.receipt!.status === "problem" ? "exception" : "delivered"}>
                    {o.receipt!.status === "problem" ? "Problem reported" : "Received"}
                  </StatusPill>,
                ),
              )}
          </ul>
        </Panel>
      )}
    </main>
  );
}
