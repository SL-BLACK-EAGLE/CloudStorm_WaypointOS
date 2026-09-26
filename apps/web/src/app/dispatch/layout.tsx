import { requireUser } from "@/lib/server/session";
import { DispatchRail } from "./_components/rail";

export default async function DispatchLayout({ children }: LayoutProps<"/dispatch">) {
  await requireUser(["dispatcher"]);
  return (
    <div className="flex min-h-dvh">
      <DispatchRail />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
