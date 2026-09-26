/**
 * Database client.
 *
 * Cloud (Neon): the Neon serverless driver over WebSockets - pooled, and it supports
 * interactive transactions, which the transactional outbox needs.
 * Local (docker compose): node-postgres against the postgres container.
 * Both expose the same Drizzle API over the same schema.
 */
import { Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Anything that can run queries: the database itself or an open transaction. */
export type Executor = Database | Tx;

export function isNeonUrl(url: string): boolean {
  return /\.neon\.tech|\.neon\.build|neon\.com/i.test(url);
}

export function createDb(url = process.env.DATABASE_URL): Database {
  if (!url) throw new Error("DATABASE_URL is not set");
  if (isNeonUrl(url)) {
    const pool = new NeonPool({ connectionString: url, max: 5 });
    // same query-builder surface as node-postgres; typed as one Database for the app
    return drizzleNeon({ client: pool, schema }) as unknown as Database;
  }
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  return drizzlePg({ client: pool, schema });
}

/** Ends the connection pool (scripts only; the app keeps its pool for the process lifetime). */
export async function closeDb(db: Database): Promise<void> {
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
}

const globalForDb = globalThis as unknown as { __waypointDb?: Database };

/** One pool per server process (survives Next.js dev hot reloads). */
export function getDb(): Database {
  globalForDb.__waypointDb ??= createDb();
  return globalForDb.__waypointDb;
}

export { schema };
