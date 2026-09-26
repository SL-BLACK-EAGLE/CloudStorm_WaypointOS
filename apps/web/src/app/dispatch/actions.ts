"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { requireUser } from "@/lib/server/session";

export async function setDepot(form: FormData) {
  await requireUser(["dispatcher"]);
  const depot = form.get("depot") === "Kandy" ? "Kandy" : "Peliyagoda";
  (await cookies()).set("wp-depot", depot, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 90 });
  refresh();
}
