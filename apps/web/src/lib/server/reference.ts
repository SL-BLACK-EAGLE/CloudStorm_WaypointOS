import "server-only";
import { loadReference } from "@waypoint/db";
import { createReference, type Reference } from "@waypoint/planner";
import { db } from "./db";

let cached: Promise<Reference> | null = null;

/** Planner reference data (outlets, fleet, districts, allowances, calendar, traffic), loaded once per process. */
export function reference(): Promise<Reference> {
  cached ??= loadReference(db())
    .then(createReference)
    .catch((e) => {
      cached = null;
      throw e;
    });
  return cached;
}
