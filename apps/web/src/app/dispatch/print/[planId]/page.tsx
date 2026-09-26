import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "@waypoint/db/orm";
import { dayLabel, hhmm, kg } from "@/lib/format";
import { db, t } from "@/lib/server/db";
import { planView } from "@/lib/server/queries/plan-view";
import { requireUser } from "@/lib/server/session";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Backup run sheets" };

/** Paper fallback (D-05): one sheet per trip, in stop order, with room for a signature. */
export default async function PrintRunSheets({ params }: PageProps<"/dispatch/print/[planId]">) {
  await requireUser(["dispatcher"]);
  const { planId } = await params;
  const [plan] = await db().select().from(t.plans).where(eq(t.plans.id, planId));
  if (!plan) notFound();
  const view = await planView(plan.id);
  return (
    <div className="bg-white p-6 text-black print:p-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <p className="text-sm">
          {view.trips.length} run sheets · {plan.depotId} · {dayLabel(plan.runDate, true)} · plan v{plan.version} ({plan.status})
        </p>
        <PrintButton />
      </div>
      {view.trips.map((tr) => (
        <section key={tr.id} className="mb-8 break-after-page border border-black p-5 print:mb-0 print:border-0">
          <header className="flex items-baseline justify-between border-b-2 border-black pb-2">
            <h1 className="num text-xl font-bold">
              {tr.code} · {tr.vehicleId}
            </h1>
            <p className="text-sm">
              {plan.depotId} → {tr.district} · {tr.brand} · departs {hhmm(tr.departureMin)} · {dayLabel(plan.runDate, true)}
            </p>
          </header>
          <table className="mt-3 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-black text-left">
                <th className="py-1">#</th>
                <th>Outlet</th>
                <th>Order</th>
                <th>Temp</th>
                <th className="text-right">Units</th>
                <th className="text-right">Weight</th>
                <th>Window</th>
                <th>Planned</th>
                <th>Dock / access</th>
                <th className="w-40">Received by (sign)</th>
              </tr>
            </thead>
            <tbody>
              {tr.stops.map((s) => (
                <tr key={s.id} className="h-10 border-b border-black/40">
                  <td>{s.seq}</td>
                  <td className="num font-bold">{s.outletId}</td>
                  <td className="num">{s.orderId}</td>
                  <td>{s.temp === "chilled" ? "CHILLED" : "ambient"}</td>
                  <td className="num text-right">{s.units}</td>
                  <td className="num text-right">{kg(s.kg)}</td>
                  <td className="num">
                    {hhmm(s.open)}–{hhmm(s.close)}
                  </td>
                  <td className="num">{hhmm(s.plannedArrive)}</td>
                  <td>
                    {s.dock}
                    {s.parking !== "normal" ? ` · ${s.parking}` : ""}
                  </td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs">
            Backup only - record arrival and proof of delivery in the Waypoint app when possible; it syncs when signal returns.
          </p>
        </section>
      ))}
    </div>
  );
}
