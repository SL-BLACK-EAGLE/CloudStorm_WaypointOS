import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db, t } from "@/lib/server/db";
import { eq } from "@waypoint/db/orm";
import { requireUser } from "@/lib/server/session";
import { outletInfo, storeOrders } from "@/lib/server/store";
import { ReceiveForm } from "./receive-form";

export const metadata: Metadata = { title: "SM-05 Receive and confirm" };

export default async function ReceivePage({ params }: PageProps<"/store/receive/[id]">) {
  const user = await requireUser(["store_manager"]);
  const { id } = await params;
  const outlet = (await outletInfo(user.outletId!))!;
  const o = (await storeOrders(outlet.id, "2000-01-01", "2100-01-01")).find((x) => x.id === id);
  if (!o) notFound();
  const issues = o.receipt ? await db().select().from(t.receiptIssues).where(eq(t.receiptIssues.orderId, o.id)) : [];
  return (
    <ReceiveForm
      order={{
        id: o.id,
        temp: o.temp,
        units: o.units,
        kg: o.weightKg,
        runDate: o.runDate,
      }}
      window={{ open: outlet.windowOpen, close: outlet.windowClose }}
      driver={
        o.stop
          ? {
              status: o.stop.status,
              vehicleId: o.stop.vehicleId,
              tripCode: o.stop.tripCode,
              arrived: o.stop.arrivedMin,
              left: o.stop.leftMin,
              eta: o.stop.etaMin ?? o.stop.plannedArrive,
              unitsHanded: o.pod?.unitsHanded ?? null,
              recipient: o.pod?.recipientName ?? null,
              signatureKey: o.pod?.signatureKey ?? null,
              photoKey: o.pod?.photoKey ?? null,
            }
          : null
      }
      receipt={
        o.receipt
          ? {
              status: o.receipt.status,
              units: o.receipt.unitsReceived,
              note: o.receipt.note ?? null,
              issues: issues.map((i) => ({
                kind: i.kind,
                units: i.units,
                note: i.note,
                photoKey: i.photoKey,
              })),
            }
          : null
      }
    />
  );
}
