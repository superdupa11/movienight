import type Database from "better-sqlite3";
import { PERSON_MIN_MOVIES_FOR_TYPEAHEAD } from "../../shared/types.js";

export type Role = "DIRECTOR" | "ACTOR";

export type PlexTag = { tagId: number; name: string; billing?: number };

/** Dedupe on Plex's tag id, not name — name matching merges different Chris Evanses. */
export function upsertPerson(db: Database.Database, tag: PlexTag): number {
  db.prepare(
    `INSERT INTO person (name, plex_tag_id) VALUES (?, ?)
     ON CONFLICT (plex_tag_id) DO UPDATE SET name = excluded.name`,
  ).run(tag.name, tag.tagId);
  const row = db.prepare("SELECT id FROM person WHERE plex_tag_id = ?").get(tag.tagId) as { id: number };
  return row.id;
}

export function setMoviePeople(
  db: Database.Database,
  movieId: string,
  role: Role,
  people: { personId: number; billing?: number }[],
): void {
  db.prepare("DELETE FROM movie_person WHERE movie_id = ? AND role = ?").run(movieId, role);
  const insert = db.prepare(
    "INSERT OR IGNORE INTO movie_person (movie_id, person_id, role, billing) VALUES (?, ?, ?, ?)",
  );
  for (const p of people) insert.run(movieId, p.personId, role, p.billing ?? null);
}

export function getPeopleForMovies(
  db: Database.Database,
  movieIds: string[],
): Map<string, { directors: string[]; cast: string[] }> {
  const result = new Map<string, { directors: string[]; cast: string[] }>();
  if (movieIds.length === 0) return result;

  const placeholders = movieIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT mp.movie_id AS movieId, mp.role AS role, mp.billing AS billing, p.name AS name
       FROM movie_person mp
       JOIN person p ON p.id = mp.person_id
       WHERE mp.movie_id IN (${placeholders})
       ORDER BY mp.movie_id, mp.role, mp.billing IS NULL, mp.billing ASC`,
    )
    .all(...movieIds) as { movieId: string; role: Role; billing: number | null; name: string }[];

  for (const id of movieIds) result.set(id, { directors: [], cast: [] });
  for (const row of rows) {
    const entry = result.get(row.movieId)!;
    if (row.role === "DIRECTOR") entry.directors.push(row.name);
    else entry.cast.push(row.name);
  }
  return result;
}

/** Typeahead: only people credited on >=2 movies — a single-credit actor is a guaranteed dead end. */
export function searchPeople(
  db: Database.Database,
  query: string,
  role: Role,
): { id: number; name: string; movieCount: number }[] {
  const rows = db
    .prepare(
      `SELECT p.id AS id, p.name AS name, COUNT(*) AS movieCount
       FROM person p
       JOIN movie_person mp ON mp.person_id = p.id AND mp.role = ?
       WHERE p.name LIKE ? COLLATE NOCASE
       GROUP BY p.id
       HAVING COUNT(*) >= ?
       ORDER BY movieCount DESC, p.name ASC
       LIMIT 20`,
    )
    .all(role, `%${query}%`, PERSON_MIN_MOVIES_FOR_TYPEAHEAD) as { id: number; name: string; movieCount: number }[];
  return rows;
}
