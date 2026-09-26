import { Package, Route, Store, Truck } from "lucide-react";
import Link from "next/link";
import { ROLE_BLURB, ROLE_LABEL, type Role } from "@/lib/roles";
import { WMark } from "./chips";

const ROLE_ICON: Record<Role, typeof Route> = { dispatcher: Route, loader: Package, driver: Truck, store_manager: Store };

/** Two-column frame for sign-in, sign-up, onboarding and pending screens (same system as the role apps). */
export function AuthShell({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="flex flex-col justify-between gap-10 border-b bg-card px-6 py-8 sm:px-10 lg:border-r lg:border-b-0 lg:py-12">
        <Link href="/" className="flex items-center gap-3">
          <WMark size={36} />
          <span className="text-lg font-semibold tracking-tight">Waypoint Delivery OS</span>
        </Link>
        <div className="max-w-md space-y-6">
          <h1 className="text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">
            One plan, from the 16:00 cutoff to the signature at the door.
          </h1>
          <p className="text-muted-foreground">
            Ordering, planning, loading, delivery and receipt for Waypoint Fresh, Style and Tech - across 120 outlets, two
            depots and 60 vehicles, with or without signal.
          </p>
          {aside ?? (
            <ul className="grid gap-3 sm:grid-cols-2">
              {(Object.keys(ROLE_LABEL) as Role[]).map((r) => {
                const Icon = ROLE_ICON[r];
                return (
                  <li key={r} className="rounded-lg border bg-background p-3">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <Icon className="size-4" aria-hidden />
                      {ROLE_LABEL[r]}
                    </div>
                    <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{ROLE_BLURB[r]}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Team CloudStorm · Tech-Triathlon 2026. All data is synthetic competition data.
        </p>
      </aside>
      <main className="flex items-center justify-center px-4 py-10 sm:px-8">{children}</main>
    </div>
  );
}
