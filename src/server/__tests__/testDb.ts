import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setArtStatus, upsertMovie, type UpsertMovieInput } from "../db/movies.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const sql = readFileSync(join(__dirname, "../db/migrations/001_init.sql"), "utf8");
  db.exec(sql);
  return db;
}

let seq = 0;

export function seedMovie(db: Database.Database, overrides: Partial<UpsertMovieInput> = {}) {
  seq += 1;
  const input: UpsertMovieInput = {
    id: `movie-${seq}`,
    title: `Test Movie ${seq}`,
    year: 2020,
    runtime: 100,
    genres: ["Comedy"],
    categories: ["COMEDY"],
    contentRating: "PG-13",
    tagline: null,
    summary: "A test movie.",
    audienceRating: 7.5,
    criticRating: 7,
    viewCount: 0,
    plexThumbPath: `/library/metadata/${seq}/thumb/1`,
    plexArtPath: `/library/metadata/${seq}/art/1`,
    plexUpdatedAt: Date.now(),
    ...overrides,
  };
  upsertMovie(db, input);
  setArtStatus(db, input.id, true, true); // pretend art is already cached, no filesystem/network needed
  return input.id;
}
