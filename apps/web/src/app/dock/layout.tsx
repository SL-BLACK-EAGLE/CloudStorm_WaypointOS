import { UserButton } from "@clerk/nextjs";
import { NotificationBell } from "@/components/wp/notification-bell";
import { TourButton } from "@/components/wp/tour";
import { RealtimeRefresh } from "@/components/wp/realtime";
import Link from "next/link";
import { WMark } from "@/components/wp/chips";
import { dayLabel, hhmm } from "@/lib/format";
import { now } from "@/lib/server/clock";
import { requireUser } from "@/lib/server/session";

/** Loader shell (L-01..L-04): the dock tablet or a phone, Sunlight mode by default. */
export default async function DockLayout({ children }: LayoutProps<"/dock">) {
  const user = await requireUser(["loader"]);
  const clock = await now();
  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col">
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b bg-background px-3 py-3 sm:gap-3 sm:px-4">
        <Link href="/dock" aria-label="Dock queue" className="hidden sm:block">
          <WMark size={40} />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg leading-tight font-semibold">Dock · {user.depotId ?? "all depots"}</p>
          <p className="truncate text-sm text-muted-foreground">{dayLabel(clock.date)}</p>
        </div>
        <p className="num text-2xl font-bold tracking-tight sm:text-3xl" aria-label="Business time" data-tour="clock">
          {hhmm(clock.minute)}
        </p>
        <span data-tour="help" className="inline-flex">
          <TourButton className="size-11" />
        </span>
        <span data-tour="bell" className="inline-flex">
          <NotificationBell channels={["role:loader", `user:${user.id}`]} />
        </span>
        <RealtimeRefresh channels={["role:loader", `depot:${user.depotId ?? "Peliyagoda"}`]} fallbackSeconds={30} />
        <UserButton />
      </header>
      <div className="flex-1">{children}</div>
    </div>
  );
}
