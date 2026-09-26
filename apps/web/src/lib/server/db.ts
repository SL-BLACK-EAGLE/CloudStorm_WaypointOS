import "server-only";
import { getDb } from "@waypoint/db";

/** The process-wide Drizzle client (Neon in the cloud, local Postgres in docker). */
export const db = () => getDb();
export * as t from "@waypoint/db/schema";
