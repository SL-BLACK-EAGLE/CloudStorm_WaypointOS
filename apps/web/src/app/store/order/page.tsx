import type { Metadata } from "next";
import { and, asc, desc, eq, inArray } from "@waypoint/db/orm";
import { db, t } from "@/lib/server/db";
import { requireUser } from "@/lib/server/session";
import { orderingRun, outletInfo } from "@/lib/server/store";
import { CUTOFF_MIN } from "@/lib/time-rules";
import { OrderWizard } from "./wizard";

export const metadata: Metadata = { title: "SM-02 Place order" };

export default async function PlaceOrderPage() {
  const user = await requireUser(["store_manager"]);
  const outlet = (await outletInfo(user.outletId!))!;
  const ordering = await orderingRun();
  const catalog = await db()
    .select()
    .from(t.products)
    .where(and(eq(t.products.brand, outlet.brand), eq(t.products.active, true)))
    .orderBy(asc(t.products.temp), asc(t.products.sku));
  // "typical order": the outlet's recent order sizes per temperature, to pre-fill a realistic basket
  const recent = await db()
    .select({ temp: t.orders.temp, units: t.orders.units })
    .from(t.orders)
    .where(and(eq(t.orders.outletId, outlet.id), inArray(t.orders.status, ["delivered", "planned", "confirmed"])))
    .orderBy(desc(t.orders.runDate))
    .limit(8);
  const typical = {
    ambient: Math.round(avg(recent.filter((r) => r.temp === "ambient").map((r) => r.units))),
    chilled: Math.round(avg(recent.filter((r) => r.temp === "chilled").map((r) => r.units))),
  };
  const minsToCutoff = ordering.clock.date < ordering.requested ? CUTOFF_MIN - ordering.clock.minute : 0;
  return (
    <OrderWizard
      outlet={{
        id: outlet.id,
        brand: outlet.brand,
        district: outlet.district,
        dock: outlet.dockType,
        open: outlet.windowOpen,
        close: outlet.windowClose,
      }}
      catalog={catalog.map((p) => ({
        sku: p.sku,
        name: p.name,
        category: p.category,
        temp: p.temp,
        unitKg: p.unitKg,
        unitM3: p.unitM3,
      }))}
      runDate={ordering.runDate}
      afterCutoff={ordering.afterCutoff}
      minsToCutoff={minsToCutoff}
      typical={typical}
    />
  );
}

function avg(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
