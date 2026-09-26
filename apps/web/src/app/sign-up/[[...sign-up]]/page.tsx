import { SignUp } from "@clerk/nextjs";
import type { Metadata } from "next";
import { AuthShell } from "@/components/wp/auth-shell";

export const metadata: Metadata = { title: "Create account" };

/** New accounts request a role on /onboarding; a dispatcher approves them before they get access. */
export default function SignUpPage() {
  return (
    <AuthShell>
      <SignUp path="/sign-up" signInUrl="/sign-in" fallbackRedirectUrl="/onboarding" />
    </AuthShell>
  );
}
