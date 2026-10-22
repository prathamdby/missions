import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

export interface DatabaseHandle {
  sqlite: Database.Database;
  db: Db;
  close: () => void;
}

const MIGRATIONS = path.join(import.meta.dirname, "../../drizzle");

/** Opens (creating if needed) and migrates the daemon database. */
export const openDatabase = (file: string): DatabaseHandle => {
  if (file !== ":memory:") {
    mkdirSync(path.dirname(file), { mode: 0o700, recursive: true });
  }
  const sqlite = new Database(file);
  if (file !== ":memory:") {
    chmodSync(file, 0o600);
  }
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS });
  return { close: () => sqlite.close(), db, sqlite };
};
