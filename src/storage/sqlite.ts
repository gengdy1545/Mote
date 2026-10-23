import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

const sqliteExperimentalWarning = "SQLite is an experimental feature and might change at any time";
const emitWarning = process.emitWarning;

// Node 22 prints this while loading node:sqlite.
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const message = typeof warning === "string" ? warning : warning.message;
  if (rest[0] === "ExperimentalWarning" && message === sqliteExperimentalWarning) return;
  Reflect.apply(emitWarning, process, [warning, ...rest]);
}) as typeof process.emitWarning;

const sqlite = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
export const DatabaseSync: typeof sqlite.DatabaseSync = sqlite.DatabaseSync;
export type DatabaseSync = DatabaseSyncType;
