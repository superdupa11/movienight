import Database from "better-sqlite3";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "migrations");

let db: Database.Database | undefined;

export function getDb(): Database.Database {
  if (db) return db;

  mkdirSync(dirname(config.dbPath), { recursive: true });
  db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

function runMigrations(database: Database.Database) {
  database.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (
       name TEXT PRIMARY KEY,
       applied_at INTEGER NOT NULL
     )`,
  );

  const applied = new Set(
    database.prepare("SELECT name FROM _migrations").all().map((r) => (r as { name: string }).name),
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const markApplied = database.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)");

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const run = database.transaction(() => {
      database.exec(sql);
      markApplied.run(file, Date.now());
    });
    run();
  }
}

/** MAX(updated_at) across movies — bumped by every ingest upsert, invalidates every cached deck for free. */
export function getLibraryVersion(database: Database.Database): number {
  const row = database.prepare("SELECT COALESCE(MAX(updated_at), 0) AS v FROM movies").get() as { v: number };
  return row.v;
}
