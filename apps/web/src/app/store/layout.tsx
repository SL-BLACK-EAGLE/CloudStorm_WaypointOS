import { UserButton } from "@clerk/nextjs";
import { notFound } from "next/navigation";
import { BrandMark, WMark } from "@/components/wp/chips";
import { DOCK_LABEL, hhmm } from "@/lib/format";
import { requireUser } from "@/lib/server/session";
import { outletInfo } from "@/lib/server/store";
import { StoreNav } from "./nav";

/** Store manager shell (SM-01..SM-05): counter desktop with top tabs, phone with bottom tabs. Light mode. */
export default async function StoreLayout({ children }: LayoutProps<"/store">) {
  const user = await requireUser(["store_manager"]);
  if (!user.outletId) notFound();
  const outlet = await outletInfo(user.outletId);
  if (!outlet) notFound();
  return (
    <div className="flex min-h-dvh flex-col pb-20 md:pb-0">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <WMark size={32} className="hidden md:inline-grid" />
          <BrandMark brand={outlet.brand} size={28} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">
              Waypoint {outlet.brand} · <span className="num">{outlet.id}</span>
            </p>
            <p className="truncate text-[13px] text-muted-foreground">
              {outlet.district} · {DOCK_LABEL[outlet.dockType]} delivery · window {hhmm(outlet.windowOpen)}–{hhmm(outlet.windowClose)}
              {outlet.mallWindow ? ` · mall ${outlet.mallWindow}` : ""}
            </p>
          </div>
          <StoreNav variant="top" />
          <UserButton />
        </div>
      </header>
      <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-5">{children}</div>
      <StoreNav variant="bottom" />
    </div>
  );
}
