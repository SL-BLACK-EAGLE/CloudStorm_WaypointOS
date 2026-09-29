import type { Metadata } from "next";
import { buildPack } from "@/lib/server/drive";
import { requireUser } from "@/lib/server/session";
import { DriveApp } from "./drive-app";

export const metadata: Metadata = { title: "Today's run" };

/**
 * DR-01..DR-05. The server builds the offline pack once; after that the phone works from
 * IndexedDB and the service worker, so losing signal on the Kandy corridor changes nothing.
 */
export default async function DrivePage() {
  const user = await requireUser(["driver"]);
  const pack = await buildPack(user);
  return <DriveApp serverPack={pack} userId={user.id} />;
}
