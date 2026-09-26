import { ShieldX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/components/wp/auth-shell";
import { ROLE_LABEL, type Role } from "@/lib/roles";

export const metadata: Metadata = { title: "No access" };

export default async function ForbiddenPage({ searchParams }: PageProps<"/forbidden">) {
  const sp = await searchParams;
  const need = typeof sp.need === "string" ? (sp.need.split(",") as Role[]) : [];
  const disabled = sp.reason === "disabled";
  return (
    <AuthShell>
      <div className="w-full max-w-md space-y-5">
        <ShieldX className="size-8" aria-hidden />
        <h1 className="text-2xl font-semibold tracking-tight">{disabled ? "Account disabled" : "This page belongs to another role"}</h1>
        <p className="text-sm text-muted-foreground">
          {disabled
            ? "A dispatcher has disabled this account."
            : need.length
              ? `It is for the ${need.map((r) => ROLE_LABEL[r] ?? r).join(" or ")} role. Your own workspace has everything your role needs.`
              : "You don't have access to this page."}
        </p>
        <Button asChild size="desk">
          <Link href="/app">Go to my workspace</Link>
        </Button>
      </div>
    </AuthShell>
  );
}
