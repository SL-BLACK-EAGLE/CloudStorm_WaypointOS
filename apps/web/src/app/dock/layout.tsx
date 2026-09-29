import { UserButton } from "@clerk/nextjs";
import { NotificationBell } from "@/components/wp/notification-bell";
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
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b bg-background px-4 py-3">
        <Link href="/dock" aria-label="Dock queue">
          <WMark size={40} />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg leading-tight font-semibold">Dock · {user.depotId ?? "all depots"}</p>
          <p className="text-sm text-muted-foreground">{dayLabel(clock.date)}</p>
        </div>
        <p className="num text-3xl font-bold tracking-tight" aria-label="Business time">
          {hhmm(clock.minute)}
        </p>
        <NotificationBell channels={["role:loader", `user:${user.id}`]} />
        <RealtimeRefresh channels={["role:loader", `depot:${user.depotId ?? "Peliyagoda"}`]} fallbackSeconds={30} />
        <UserButton />
      </header>
      <div className="flex-1">{children}</div>
    </div>
  );
}
