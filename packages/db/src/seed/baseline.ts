/**
 * Demo baseline: a copy of the freshly seeded operational tables kept in the same database
 * (schema `demo_baseline`). The /demo panel's "Reset demo data" restores from it in seconds and
 * needs no CSV files, so it works on a hosted deployment where the confidential dataset must
 * not be shipped. Seeding from the CSVs writes the baseline; restoring never reads the CSVs.
 */
import { sql } from "drizzle-orm";
import type { Database } from "../client";

/** Operational tables in foreign-key order (parents first). Reference data and users are not reset. */
export const OPS_TABLES = [
  "products",
  "orders",
  "order_lines",
  "plans",
  "trips",
  "trip_stops",
  "deferrals",
  "load_checks",
  "shortfalls",
  "dock_signoffs",
  "pods",
  "stop_exceptions",
  "receipts",
  "receipt_issues",
  "messages",
  "notifications",
  "fuel_ledger",
  "forecasts",
  "sync_events",
  "conflicts",
  "audit_log",
  "outbox",
  "vehicle_days",
  "app_settings",
] as const;

/** Tables with a serial/bigserial id whose sequence must follow restored rows. */
const SERIAL_IDS = ["audit_log", "outbox"] as const;

export async function saveBaseline(db: Database) {
  await db.execute(sql`create schema if not exists demo_baseline`);
  for (const table of OPS_TABLES) {
    await db.execute(sql.raw(`drop table if exists demo_baseline.${table}`));
    await db.execute(sql.raw(`create table demo_baseline.${table} as table public.${table}`));
  }
}

export async function hasBaseline(db: Database) {
  const r = await db.execute(sql`select count(*)::int as n from information_schema.tables where table_schema = 'demo_baseline'`);
  const n = (r.rows?.[0] as { n?: number } | undefined)?.n ?? 0;
  return n >= OPS_TABLES.length;
}

/** Puts every operational table back to the seeded state, in one transaction. */
export async function restoreBaseline(db: Database) {
  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`truncate table ${[...OPS_TABLES, "files"].join(", ")} restart identity cascade`));
    for (const table of OPS_TABLES) await tx.execute(sql.raw(`insert into public.${table} select * from demo_baseline.${table}`));
    for (const table of SERIAL_IDS) {
      await tx.execute(sql.raw(`select setval(pg_get_serial_sequence('public.${table}', 'id'), coalesce((select max(id) from public.${table}), 0) + 1, false)`));
    }
  });
}
