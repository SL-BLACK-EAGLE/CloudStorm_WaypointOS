import { requireUser } from "@/lib/server/session";

export default async function Layout({ children }: LayoutProps<"/dock">) {
  await requireUser(["loader"]);
  return <>{children}</>;
}
