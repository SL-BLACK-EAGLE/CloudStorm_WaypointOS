"use client";

import { ClipboardCheck, House, PackagePlus, Route } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/store", label: "Home", icon: House, exact: true },
  { href: "/store/order", label: "Order", icon: PackagePlus },
  { href: "/store/track", label: "Track", icon: Route },
  { href: "/store/receive", label: "Receive", icon: ClipboardCheck },
] as const;

export function StoreNav({ variant }: { variant: "top" | "bottom" }) {
  const path = usePathname();
  const on = (t: (typeof TABS)[number]) =>
    "exact" in t && t.exact
      ? path === t.href
      : path === t.href || path.startsWith(`${t.href}/`) || (t.href === "/store/track" && path.startsWith("/store/orders"));
  if (variant === "top")
    return (
      <nav aria-label="Store" className="hidden gap-1 md:flex">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            aria-current={on(t) ? "page" : undefined}
            className={cn(
              "h-9 rounded-md px-3 text-sm leading-9 text-muted-foreground hover:bg-muted hover:text-foreground",
              on(t) && "bg-accent font-medium text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    );
  return (
    <nav aria-label="Store" className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t bg-background md:hidden">
      {TABS.map((t) => {
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={on(t) ? "page" : undefined}
            className={cn("flex h-16 flex-col items-center justify-center gap-1 text-[12px] text-muted-foreground", on(t) && "font-semibold text-foreground")}
          >
            <Icon className="size-5" aria-hidden />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
