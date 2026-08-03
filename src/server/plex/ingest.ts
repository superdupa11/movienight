import type Database from "better-sqlite3";
import { getKnownPlexVersions, setArtStatus, upsertMovie } from "../db/movies.js";
import { setMoviePeople, upsertPerson } from "../db/people.js";
import { getMovieDetail, getMovieSectionKeys, getSectionMovies, type PlexTagRef } from "./client.js";
import { mapGenresToCategories } from "./categoryMap.js";
import { ensureArt } from "./poster.js";

export type IngestSummary = {
  sectionsScanned: number;
  moviesSeen: number;
  detailFetches: number;
  artMisses: number;
  durationMs: number;
};

const DETAIL_FETCH_CONCURRENCY = 4;

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

/**
 * PROTOCOL §3 "The ingest gotcha" — base rows in one call per section, cast/
 * directors need a per-movie detail call, so we only pay that N+1 for movies
 * Plex reports as new or changed since the last run.
 */
export async function runNightlyIngest(db: Database.Database): Promise<IngestSummary> {
  const start = Date.now();
  const sectionKeys = await getMovieSectionKeys();
  const knownVersions = getKnownPlexVersions(db);

  let moviesSeen = 0;
  let detailFetches = 0;
  let artMisses = 0;

  for (const sectionKey of sectionKeys) {
    const items = await getSectionMovies(sectionKey);
    moviesSeen += items.length;

    await mapPool(items, DETAIL_FETCH_CONCURRENCY, async (item) => {
      const changed = knownVersions.get(item.ratingKey) !== (item.updatedAt ?? 0);
      let genreTags = item.Genre?.map((g) => g.tag) ?? [];
      let detail: Awaited<ReturnType<typeof getMovieDetail>> | undefined;

      if (changed) {
        detailFetches++;
        detail = await getMovieDetail(item.ratingKey);
        if (detail?.Genre?.length) genreTags = detail.Genre.map((g) => g.tag);
      }

      const categories = mapGenresToCategories(genreTags);
      const { hasPoster, hasBackdrop } = await ensureArt(item.ratingKey, item.thumb ?? null, item.art ?? null);
      if (!hasPoster) artMisses++;

      // The movie row must exist before movie_person rows can reference it
      // (FK constraint) — upsert it first, especially for a first-ever sync
      // where every title is "new".
      upsertMovie(db, {
        id: item.ratingKey,
        title: item.title,
        year: item.year ?? null,
        runtime: item.duration ? Math.round(item.duration / 60_000) : 0,
        genres: genreTags,
        categories,
        contentRating: item.contentRating ?? null,
        tagline: item.tagline ?? null,
        summary: item.summary ?? "",
        audienceRating: item.audienceRating ?? null,
        criticRating: item.rating ?? null,
        viewCount: item.viewCount ?? 0,
        plexThumbPath: item.thumb ?? null,
        plexArtPath: item.art ?? null,
        plexUpdatedAt: item.updatedAt ?? 0,
      });
      setArtStatus(db, item.ratingKey, hasPoster, hasBackdrop);

      if (detail) {
        upsertPeopleForMovie(db, item.ratingKey, "DIRECTOR", detail.Director ?? []);
        upsertPeopleForMovie(db, item.ratingKey, "ACTOR", detail.Role ?? []);
      }
    });
  }

  return { sectionsScanned: sectionKeys.length, moviesSeen, detailFetches, artMisses, durationMs: Date.now() - start };
}

function upsertPeopleForMovie(db: Database.Database, movieId: string, role: "DIRECTOR" | "ACTOR", tags: PlexTagRef[]) {
  const withIds = tags
    .filter((t): t is PlexTagRef & { id: number } => t.id != null)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((t) => ({ personId: upsertPerson(db, { tagId: t.id, name: t.tag }), billing: t.order }));
  setMoviePeople(db, movieId, role, withIds);
}
