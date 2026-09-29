"use client";

import { UserButton } from "@clerk/nextjs";
import { NotificationBell } from "@/components/wp/notification-bell";
import { Activity, ChartLine, Inbox, LayoutGrid, Send, SkipForward, SquareKanban, Truck, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { WMark } from "@/components/wp/chips";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dispatch", label: "Tower", icon: LayoutGrid, exact: true },
  { href: "/dispatch/orders", label: "Orders", icon: Inbox },
  { href: "/dispatch/plan", label: "Plan", icon: SquareKanban },
  { href: "/dispatch/deferrals", label: "Deferrals", icon: SkipForward },
  { href: "/dispatch/publish", label: "Publish", icon: Send },
  { href: "/dispatch/live", label: "Live", icon: Activity },
  { href: "/dispatch/forecast", label: "Forecast", icon: ChartLine },
] as const;

const ADMIN = [
  { href: "/dispatch/fleet", label: "Fleet", icon: Truck },
  { href: "/dispatch/users", label: "People", icon: Users },
] as const;

/** D-01..D-07 left rail: the W mark, one item per screen, labels under icons. */
export function DispatchRail() {
  const path = usePathname();
  const item = (n: { href: string; label: string; icon: typeof Inbox; exact?: boolean }) => {
    const on = "exact" in n && n.exact ? path === n.href : path === n.href || path.startsWith(`${n.href}/`);
    const Icon = n.icon;
    return (
      <Link
        key={n.href}
        href={n.href}
        aria-current={on ? "page" : undefined}
        className={cn(
          "flex w-full flex-col items-center gap-1 rounded-lg px-1 py-2 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          on && "bg-accent font-medium text-foreground",
        )}
      >
        <Icon className="size-5" aria-hidden />
        {n.label}
      </Link>
    );
  };
  return (
    <nav
      aria-label="Dispatcher"
      className="sticky top-0 flex h-dvh w-[76px] print:hidden shrink-0 flex-col items-center gap-1 border-r bg-sidebar px-1.5 py-3"
    >
      <Link href="/dispatch" className="mb-3" aria-label="Control tower">
        <WMark size={36} />
      </Link>
      {NAV.map(item)}
      <div className="my-2 h-px w-10 bg-border" />
      {ADMIN.map(item)}
      <div className="mt-auto flex flex-col items-center gap-2 pb-1">
        <NotificationBell side="right" />
        <UserButton />
      </div>
    </nav>
  );
}
