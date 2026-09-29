"use server";

import { refresh } from "next/cache";
import { clearDatathonForecast, uploadForecast } from "@/lib/server/forecast";
import { requireUser } from "@/lib/server/session";
import type { ActionResult } from "../actions";

/** D-07 "Load forecast file": the Datathon Task 2A submission (or a long depot/brand/week file). */
export async function uploadForecastAction(form: FormData): Promise<ActionResult> {
  const user = await requireUser(["dispatcher"]);
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a CSV file" };
  if (file.size > 512 * 1024) return { ok: false, error: "The file is too large for a 60-row forecast" };
  try {
    const r = await uploadForecast(await file.text(), user.id);
    refresh();
    return { ok: true, message: `Loaded ${r.rows} forecast rows for ISO weeks ${r.from}–${r.to}.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not read the file" };
  }
}

export async function clearForecastAction(): Promise<ActionResult> {
  const user = await requireUser(["dispatcher"]);
  await clearDatathonForecast(user.id);
  refresh();
  return { ok: true, message: "Datathon forecast removed - showing the baseline." };
}
