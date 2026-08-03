import type Database from "better-sqlite3";
import type { CategoryId, Movie } from "../../shared/types.js";
import { config } from "../config.js";

export type MovieRow = {
  id: string;
  title: string;
  year: number | null;
  runtime: number;
  genres: string; // JSON string[]
  categories: string; // JSON CategoryId[]
  content_rating: string | null;
  tagline: string | null;
  summary: string;
  audience_rating: number | null;
  critic_rating: number | null;
  view_count: number;
  plex_thumb_path: string | null;
  plex_art_path: string | null;
  plex_updated_at: number;
  has_poster: number;
  has_backdrop: number;
  updated_at: number;
};

export type UpsertMovieInput = {
  id: string;
  title: string;
  year: number | null;
  runtime: number;
  genres: string[];
  categories: CategoryId[];
  contentRating: string | null;
  tagline: string | null;
  summary: string;
  audienceRating: number | null;
  criticRating: number | null;
  viewCount: number;
  plexThumbPath: string | null;
  plexArtPath: string | null;
  plexUpdatedAt: number;
};

export function upsertMovie(db: Database.Database, input: UpsertMovieInput): void {
  db.prepare(
    `INSERT INTO movies (
       id, title, year, runtime, genres, categories, content_rating, tagline,
       summary, audience_rating, critic_rating, view_count, plex_thumb_path,
       plex_art_path, plex_updated_at, has_poster, has_backdrop, updated_at
     ) VALUES (
       @id, @title, @year, @runtime, @genres, @categories, @contentRating, @tagline,
       @summary, @audienceRating, @criticRating, @viewCount, @plexThumbPath,
       @plexArtPath, @plexUpdatedAt, 0, 0, @updatedAt
     )
     ON CONFLICT (id) DO UPDATE SET
       title = excluded.title,
       year = excluded.year,
       runtime = excluded.runtime,
       genres = excluded.genres,
       categories = excluded.categories,
       content_rating = excluded.content_rating,
       tagline = excluded.tagline,
       summary = excluded.summary,
       audience_rating = excluded.audience_rating,
       critic_rating = excluded.critic_rating,
       view_count = excluded.view_count,
       plex_thumb_path = excluded.plex_thumb_path,
       plex_art_path = excluded.plex_art_path,
       plex_updated_at = excluded.plex_updated_at,
       updated_at = excluded.updated_at`,
  ).run({
    ...input,
    genres: JSON.stringify(input.genres),
    categories: JSON.stringify(input.categories),
    updatedAt: Date.now(),
  });

  db.prepare("DELETE FROM movie_category WHERE movie_id = ?").run(input.id);
  const insertCat = db.prepare("INSERT OR IGNORE INTO movie_category (movie_id, category_id) VALUES (?, ?)");
  for (const c of input.categories) insertCat.run(input.id, c);
}

export function setArtStatus(db: Database.Database, movieId: string, hasPoster: boolean, hasBackdrop: boolean): void {
  db.prepare("UPDATE movies SET has_poster = ?, has_backdrop = ? WHERE id = ?").run(
    hasPoster ? 1 : 0,
    hasBackdrop ? 1 : 0,
    movieId,
  );
}

export function artPaths(movieId: string): { posterPath: string; backdropPath: string } {
  return {
    posterPath: `${config.artCacheDir}/${movieId}-poster.webp`,
    backdropPath: `${config.artCacheDir}/${movieId}-backdrop.webp`,
  };
}

export function rowToMovie(row: MovieRow, directors: string[], cast: string[]): Movie {
  return {
    id: row.id,
    title: row.title,
    year: row.year ?? 0,
    runtime: row.runtime,
    genres: JSON.parse(row.genres),
    categories: JSON.parse(row.categories),
    contentRating: row.content_rating ?? undefined,
    posterUrl: `/art/${row.id}/poster.webp`,
    backdropUrl: row.has_backdrop ? `/art/${row.id}/backdrop.webp` : undefined,
    tagline: row.tagline ?? undefined,
    summary: row.summary.length > 400 ? row.summary.slice(0, 400).trimEnd() + "…" : row.summary,
    directors,
    cast: cast.slice(0, 3),
    audienceRating: row.audience_rating ?? undefined,
    criticRating: row.critic_rating ?? undefined,
    unwatched: row.view_count === 0,
  };
}

/** id -> Plex's own updatedAt, for §3 step 3 change detection (skip re-fetching detail for unchanged titles). */
export function getKnownPlexVersions(db: Database.Database): Map<string, number> {
  const rows = db.prepare("SELECT id, plex_updated_at AS plexUpdatedAt FROM movies").all() as {
    id: string;
    plexUpdatedAt: number;
  }[];
  return new Map(rows.map((r) => [r.id, r.plexUpdatedAt]));
}

export function getArtSources(db: Database.Database, ids: string[]): Map<string, { thumb: string | null; art: string | null }> {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT id, plex_thumb_path AS thumb, plex_art_path AS art FROM movies WHERE id IN (${placeholders})`)
    .all(...ids) as { id: string; thumb: string | null; art: string | null }[];
  return new Map(rows.map((r) => [r.id, { thumb: r.thumb, art: r.art }]));
}

export function getMovieRows(db: Database.Database, ids: string[]): MovieRow[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = db.prepare(`SELECT * FROM movies WHERE id IN (${placeholders})`).all(...ids) as MovieRow[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  // preserve caller order (deck order matters — same order for everyone)
  return ids.map((id) => byId.get(id)).filter((r): r is MovieRow => !!r);
}
