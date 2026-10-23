import { chmodSync, mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";

import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

export interface DatabaseHandle {
  sqlite: Database.Database;
  db: Db;
  close: () => void;
}

const MIGRATIONS = path.join(import.meta.dirname, "../../drizzle");

/**
 * Drizzle silently skips migrations older than the newest applied one, so a
 * database written by a newer build would otherwise open with a schema this
 * build does not understand.
 */
const assertKnownSchema = (sqlite: Database.Database, file: string) => {
  const tracked = sqlite
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'"
    )
    .get();
  if (!tracked) {
    return;
  }
  const { latest } = sqlite
    .prepare("SELECT MAX(created_at) AS latest FROM __drizzle_migrations")
    .get() as { latest: number | string | null };
  const known = Math.max(
    ...readMigrationFiles({ migrationsFolder: MIGRATIONS }).map(
      (migration) => migration.folderMillis
    )
  );
  if (latest !== null && Number(latest) > known) {
    throw new Error(
      `The Missions database at ${file} was written by a newer version of Missions. Update Missions, or move the database aside to start fresh.`
    );
  }
};

/**
 * Before applying migrations to an existing database, keep a consistent copy
 * next to it. Rollback restores this copy with the matching app/daemon pair;
 * downgrading over upgraded records is unsupported.
 */
export const backupBeforeMigration = (
  sqlite: Database.Database,
  file: string
): string | null => {
  if (file === ":memory:") {
    return null;
  }
  const tracked = sqlite
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'"
    )
    .get();
  if (!tracked) {
    return null;
  }
  const { applied } = sqlite
    .prepare("SELECT COUNT(*) AS applied FROM __drizzle_migrations")
    .get() as { applied: number };
  const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS });
  if (applied >= migrations.length) {
    return null;
  }
  const target = `${file}.pre-migration-${applied}.bak`;
  // An earlier attempt's copy may predate later writes, so always take a
  // fresh one and swap it in only once it is complete.
  const partial = `${target}.partial`;
  rmSync(partial, { force: true });
  sqlite.exec(`VACUUM INTO '${partial.replaceAll("'", "''")}'`);
  chmodSync(partial, 0o600);
  renameSync(partial, target);
  return target;
};

const prepare = (sqlite: Database.Database, file: string) => {
  try {
    sqlite.pragma("journal_mode = WAL");
  } catch (error) {
    if (
      error instanceof Database.SqliteError &&
      error.code === "SQLITE_NOTADB"
    ) {
      throw new Error(
        `${file} is not a Missions database. Move it aside so Missions can create a new one.`,
        { cause: error }
      );
    }
    throw error;
  }
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  assertKnownSchema(sqlite, file);
  backupBeforeMigration(sqlite, file);
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS });
  return db;
};

/** Opens (creating if needed) and migrates the daemon database. */
export const openDatabase = (file: string): DatabaseHandle => {
  if (file !== ":memory:") {
    mkdirSync(path.dirname(file), { mode: 0o700, recursive: true });
  }
  const sqlite = new Database(file);
  try {
    if (file !== ":memory:") {
      chmodSync(file, 0o600);
    }
    const db = prepare(sqlite, file);
    return {
      close: () => {
        if (sqlite.open) {
          sqlite.close();
        }
      },
      db,
      sqlite,
    };
  } catch (error) {
    sqlite.close();
    throw error;
  }
};
