import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getAppUser, homeFor } from "@/lib/server/session";

/** Post-sign-in router: sends each user to their role's workspace, or to onboarding/pending. */
export default async function AppRouterPage() {
  await auth.protect();
  const user = await getAppUser();
  if (!user) redirect("/sign-in");
  redirect(homeFor(user));
}
