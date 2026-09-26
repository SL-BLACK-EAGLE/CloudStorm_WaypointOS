import { requireUser } from "@/lib/server/session";

export default async function Layout({ children }: LayoutProps<"/store">) {
  await requireUser(["store_manager"]);
  return <>{children}</>;
}
