import { SignIn } from "@clerk/nextjs";
import type { Metadata } from "next";
import { AuthShell } from "@/components/wp/auth-shell";
import { DemoAccounts } from "@/components/wp/demo-accounts";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <AuthShell aside={<DemoAccounts />}>
      <SignIn path="/sign-in" signUpUrl="/sign-up" fallbackRedirectUrl="/app" />
    </AuthShell>
  );
}
