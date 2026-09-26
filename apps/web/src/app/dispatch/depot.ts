import "server-only";
import { cookies } from "next/headers";

export type DepotId = "Peliyagoda" | "Kandy";

/** The depot the dispatcher is looking at (remembered per browser). */
export async function currentDepot(): Promise<DepotId> {
  const v = (await cookies()).get("wp-depot")?.value;
  return v === "Kandy" ? "Kandy" : "Peliyagoda";
}
