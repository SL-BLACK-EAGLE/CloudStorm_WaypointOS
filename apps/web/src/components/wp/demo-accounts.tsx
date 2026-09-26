import { KeyRound } from "lucide-react";
import { ROLE_LABEL, type Role } from "@/lib/roles";

/** Seeded judge accounts (booklet: "credentials for four seeded accounts, one per user role"). */
export const DEMO_ACCOUNTS: Array<{ role: Role; email: string; who: string; scope: string }> = [
  { role: "dispatcher", email: "dispatcher+clerk_test@waypoint-demo.lk", who: "Nirmala Perera", scope: "Peliyagoda planning office" },
  { role: "store_manager", email: "store+clerk_test@waypoint-demo.lk", who: "Fathima Rizwan", scope: "OUT006 · Fresh · Colombo" },
  { role: "loader", email: "loader+clerk_test@waypoint-demo.lk", who: "Suresh Kumar", scope: "Peliyagoda dock" },
  { role: "driver", email: "driver+clerk_test@waypoint-demo.lk", who: "Ruwan Bandara", scope: "Peliyagoda fleet" },
];
export const DEMO_PASSWORD = "Waypoint-Demo-2026";

export function showDemoAccounts() {
  return process.env.NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS !== "false";
}

export function DemoAccounts() {
  if (!showDemoAccounts()) return null;
  return (
    <section aria-labelledby="demo-accounts" className="rounded-lg border bg-background p-4">
      <h2 id="demo-accounts" className="flex items-center gap-2 text-sm font-semibold">
        <KeyRound className="size-4" aria-hidden /> Judge accounts
      </h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        Password for all four: <span className="num font-medium text-foreground">{DEMO_PASSWORD}</span>
        <br />
        If Clerk asks for a verification code, enter <span className="num font-medium text-foreground">424242</span>.
      </p>
      <dl className="mt-3 divide-y text-[13px]">
        {DEMO_ACCOUNTS.map((a) => (
          <div key={a.role} className="grid grid-cols-[7.5rem_1fr] gap-2 py-1.5">
            <dt className="font-medium">{ROLE_LABEL[a.role]}</dt>
            <dd className="min-w-0">
              <span className="num block truncate">{a.email}</span>
              <span className="text-muted-foreground">{a.scope}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
