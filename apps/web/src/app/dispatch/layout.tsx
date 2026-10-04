import { DepartureAlerts } from "@/components/wp/departure-alerts";
import { RealtimeRefresh } from "@/components/wp/realtime";
import { requireUser } from "@/lib/server/session";
import { DispatchRail } from "./_components/rail";
import { currentDepot } from "./depot";

export default async function DispatchLayout({ children }: LayoutProps<"/dispatch">) {
  await requireUser(["dispatcher"]);
  const depot = await currentDepot();
  return (
    <div className="flex min-h-dvh">
      <DispatchRail />
      <div className="min-w-0 flex-1">{children}</div>
      {/* every dispatcher screen follows new orders, plan changes, dock and driver events */}
      <RealtimeRefresh channels={["orders", "role:dispatcher", `depot:${depot}`]} />
      <DepartureAlerts role="dispatcher" channels={["role:dispatcher", `depot:${depot}`]} className="top-[72px]" />
    </div>
  );
}
