import { ArrowRight, CloudOff, Scale, Snowflake, TimerReset } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { WMark } from "@/components/wp/chips";
import { DemoAccounts } from "@/components/wp/demo-accounts";
import { ROLE_BLURB, ROLE_LABEL, type Role } from "@/lib/roles";
import { getAppUser, homeFor } from "@/lib/server/session";

const PILLARS = [
  {
    icon: Scale,
    title: "Explainable allocation",
    body: "Every order is served or deferred with a reason: unavoidable, capacity-forced, or chosen - and what it was lost to.",
  },
  {
    icon: Snowflake,
    title: "Scarce resources first",
    body: "Reefers, van-only outlets and the 270-minute Fresh window are planned before anything else, then checked rule by rule.",
  },
  {
    icon: CloudOff,
    title: "Works without signal",
    body: "Drivers record arrival and proof of delivery offline on the Kandy corridor; records reconcile exactly once on reconnect.",
  },
  {
    icon: TimerReset,
    title: "Late risk the evening before",
    body: "Expected times use district traffic and road disruption, so stores get honest ETAs and dispatchers see risk early.",
  },
];

export default async function Landing() {
  const user = await getAppUser().catch(() => null);
  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-8">
        <div className="flex items-center gap-3">
          <WMark size={36} />
          <span className="text-lg font-semibold tracking-tight">Waypoint Delivery OS</span>
        </div>
        <nav className="flex items-center gap-2">
          {user ? (
            <Button asChild size="desk">
              <Link href={homeFor(user)}>
                Open my workspace <ArrowRight />
              </Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="desk">
                <Link href="/sign-up">Create account</Link>
              </Button>
              <Button asChild size="desk">
                <Link href="/sign-in">Sign in</Link>
              </Button>
            </>
          )}
        </nav>
      </header>

      <main className="mx-auto grid max-w-6xl gap-10 px-4 pt-8 pb-16 sm:px-8 lg:grid-cols-[1.25fr_1fr] lg:pt-16">
        <section className="space-y-8">
          <p className="num text-xs tracking-widest text-muted-foreground uppercase">Waypoint Group · Tech-Triathlon 2026</p>
          <h1 className="text-4xl leading-[1.1] font-semibold tracking-tight sm:text-5xl">
            Deliveries you can plan, load, track and explain.
          </h1>
          <p className="max-w-xl text-lg text-muted-foreground">
            One system for the store manager who orders before 16:00, the dispatcher who plans the night, the loader at the
            dock and the driver on the hill-country road.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {PILLARS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-lg border bg-card p-4">
                <Icon className="size-5" aria-hidden />
                <h2 className="mt-3 font-semibold">{title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <aside className="space-y-4">
          <div className="rounded-xl border bg-card p-5">
            <h2 className="font-semibold">Four roles, one plan</h2>
            <ul className="mt-3 space-y-3">
              {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                <li key={r} className="text-sm">
                  <span className="font-medium">{ROLE_LABEL[r]}</span>
                  <span className="text-muted-foreground"> - {ROLE_BLURB[r]}</span>
                </li>
              ))}
            </ul>
            {!user && (
              <Button asChild size="field" className="mt-5">
                <Link href="/sign-in">
                  Sign in to start <ArrowRight />
                </Link>
              </Button>
            )}
          </div>
          <DemoAccounts />
        </aside>
      </main>
    </div>
  );
}
