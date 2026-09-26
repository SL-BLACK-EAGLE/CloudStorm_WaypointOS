import { requireUser } from "@/lib/server/session";

export default async function Layout({ children }: LayoutProps<"/drive">) {
  await requireUser(["driver"]);
  return <>{children}</>;
}
