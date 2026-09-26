/** Reads the organisers' CSVs from SEED_DATA_DIR (git-ignored; see seed-data/README.md). */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse } from "csv-parse/sync";

/** The monorepo root (the folder holding pnpm-workspace.yaml). */
function repoRoot(): string {
  let dir = process.cwd();
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const up = dirname(dir);
    if (up === dir) return process.cwd();
    dir = up;
  }
  return dir;
}

export function dataDir(): string {
  // relative paths are relative to the repo root, wherever the script runs from
  const base = resolve(repoRoot(), process.env.SEED_DATA_DIR ?? "seed-data");
  const dir = join(base, "data");
  if (!existsSync(join(dir, "General Data", "outlets.csv"))) {
    throw new Error(
      `Competition CSVs not found under ${dir}.\n` +
        "Copy the organisers' dataset into seed-data/ (see seed-data/README.md) and set SEED_DATA_DIR.",
    );
  }
  return dir;
}

export type Row = Record<string, string>;

export function readCsv(folder: string, name: string): Row[] {
  const text = readFileSync(join(dataDir(), folder, name), "utf8");
  return parse(text, { columns: true, skip_empty_lines: true, trim: true }) as Row[];
}

export const num = (s: string | undefined): number => Number(s);
export const int = (s: string | undefined): number => Math.trunc(Number(s));
export const orNull = (s: string | undefined): string | null => (s === undefined || s === "" ? null : s);
