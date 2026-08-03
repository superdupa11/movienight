import type Database from "better-sqlite3";
import {
  CATEGORY_IDS,
  CATEGORY_LABELS,
  DECK_LIMIT_MAX,
  type CategoryId,
  type CategoryOption,
  type DeckFilters,
} from "../../shared/types.js";

type WhereClause = { sql: string; params: (string | number)[] };

/** Builds the shared WHERE clause. `categories` is OR-combined (multi-select); empty = any genre. */
function buildWhereClause(filters: DeckFilters, categories: CategoryId[]): WhereClause {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (categories.length > 0) {
    const placeholders = categories.map(() => "?").join(",");
    clauses.push(
      `EXISTS (SELECT 1 FROM movie_category mc WHERE mc.movie_id = movies.id AND mc.category_id IN (${placeholders}))`,
    );
    params.push(...categories);
  }

  if (filters.directors && filters.directors.length > 0) {
    const placeholders = filters.directors.map(() => "?").join(",");
    clauses.push(
      `EXISTS (SELECT 1 FROM movie_person mp WHERE mp.movie_id = movies.id AND mp.role = 'DIRECTOR' AND mp.person_id IN (${placeholders}))`,
    );
    params.push(...filters.directors);
  }

  if (filters.cast && filters.cast.length > 0) {
    const placeholders = filters.cast.map(() => "?").join(",");
    clauses.push(
      `EXISTS (SELECT 1 FROM movie_person mp2 WHERE mp2.movie_id = movies.id AND mp2.role = 'ACTOR' AND mp2.person_id IN (${placeholders}))`,
    );
    params.push(...filters.cast);
  }

  if (filters.maxRuntime != null) {
    clauses.push("movies.runtime <= ? AND movies.runtime > 0");
    params.push(filters.maxRuntime);
  }

  if (filters.unwatchedOnly) {
    clauses.push("movies.view_count = 0");
  }

  if (filters.yearMin != null) {
    clauses.push("movies.year >= ?");
    params.push(filters.yearMin);
  }

  if (filters.yearMax != null) {
    clauses.push("movies.year <= ?");
    params.push(filters.yearMax);
  }

  // Broken-art movies never make it into a deck (§3 "the broken-art check").
  clauses.push("movies.has_poster = 1");

  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

export function countQualifying(db: Database.Database, filters: DeckFilters, categories: CategoryId[]): number {
  const { sql, params } = buildWhereClause(filters, categories);
  const row = db.prepare(`SELECT COUNT(*) AS n FROM movies ${sql}`).get(...params) as { n: number };
  return row.n;
}

/**
 * Deterministic, pre-shuffle candidate ids — the *full* matching set (no
 * default-40 trim), capped at DECK_LIMIT_MAX only as a technical safety
 * ceiling against a pathological "every category" selection.
 */
export function getQualifyingMovieIds(db: Database.Database, filters: DeckFilters, categories: CategoryId[]): string[] {
  const { sql, params } = buildWhereClause(filters, categories);
  const rows = db
    .prepare(`SELECT movies.id AS id FROM movies ${sql} ORDER BY movies.id LIMIT ?`)
    .all(...params, DECK_LIMIT_MAX) as { id: string }[];
  return rows.map((r) => r.id);
}

/**
 * Live per-category counts against the host-controlled filters only
 * (runtime/unwatched/people) — multi-select means there's no single "current
 * category" to exclude the way single-select did, so this is now a plain,
 * mode-independent computation reused for every viewer.
 */
export function getCategoryOptions(db: Database.Database, filters: DeckFilters): CategoryOption[] {
  return CATEGORY_IDS.map((id) => {
    const count = countQualifying(db, filters, [id]);
    return { id, label: CATEGORY_LABELS[id], count };
  });
}

export function canonicalizeFilters(filters: DeckFilters, categories: CategoryId[]): string {
  const normalized = {
    categories: [...categories].sort(),
    directors: [...(filters.directors ?? [])].sort((a, b) => a - b),
    cast: [...(filters.cast ?? [])].sort((a, b) => a - b),
    maxRuntime: filters.maxRuntime ?? null,
    unwatchedOnly: !!filters.unwatchedOnly,
    yearMin: filters.yearMin ?? null,
    yearMax: filters.yearMax ?? null,
  };
  return JSON.stringify(normalized);
}

export const _testables = { buildWhereClause };
