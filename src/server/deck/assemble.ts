import type Database from "better-sqlite3";
import type { Movie } from "../../shared/types.js";
import { getMovieRows, rowToMovie } from "../db/movies.js";
import { getPeopleForMovies } from "../db/people.js";

/** movieIds order is preserved — deck order is decided by the caller (shuffle), not this. */
export function assembleMovies(db: Database.Database, movieIds: string[]): Movie[] {
  const rows = getMovieRows(db, movieIds);
  const people = getPeopleForMovies(db, movieIds);
  return rows.map((row) => {
    const p = people.get(row.id) ?? { directors: [], cast: [] };
    return rowToMovie(row, p.directors, p.cast);
  });
}
