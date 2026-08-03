import type Database from "better-sqlite3";
import type { CategoryOption, DeckFilters } from "../../shared/types.js";
import { getLibraryVersion } from "../db/index.js";
import { getArtSources, setArtStatus } from "../db/movies.js";
import { ensureArt } from "../plex/poster.js";
import { getCachedDeck, setCachedDeck } from "./cache.js";
import { computeDeckHash } from "./deckHash.js";
import { countQualifying, getCategoryOptions, getQualifyingMovieIds } from "./filters.js";

export type PrewarmResult = {
  deckHash: string;
  qualifyingCount: number;
  deckSize: number; // min(qualifyingCount, filters.limit) — what the room actually deals
  categories: CategoryOption[];
};

const SELF_HEAL_CONCURRENCY = 6;

async function verifyPool(ids: string[], db: Database.Database, onProgress?: (done: number, total: number) => void): Promise<string[]> {
  const sources = getArtSources(db, ids);
  const verified: string[] = [];
  let done = 0;
  let next = 0;

  async function worker() {
    while (next < ids.length) {
      const id = ids[next++] as string;
      const src = sources.get(id);
      const { hasPoster, hasBackdrop } = await ensureArt(id, src?.thumb ?? null, src?.art ?? null);
      setArtStatus(db, id, hasPoster, hasBackdrop);
      if (hasPoster) verified.push(id);
      done++;
      onProgress?.(done, ids.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(SELF_HEAL_CONCURRENCY, ids.length) || 1 }, worker));
  // preserve original (deterministic id) order rather than worker-completion order
  const verifiedSet = new Set(verified);
  return ids.filter((id) => verifiedSet.has(id));
}

/**
 * PROTOCOL §3 "What actually needs warming" — a disk check, not a transcode,
 * *if* nightly ingest did its job. Self-heals any drift (deleted file, an art
 * miss the last ingest run recorded) so a stale flag can't seat a grey card.
 */
export async function prewarmDeck(
  db: Database.Database,
  filters: DeckFilters,
  onProgress?: (done: number, total: number) => void,
): Promise<PrewarmResult> {
  const libraryVersion = getLibraryVersion(db);
  const deckHash = computeDeckHash(filters, libraryVersion);
  const categories = getCategoryOptions(db, filters);
  const qualifyingCount = countQualifying(db, filters);
  const deckSize = Math.min(qualifyingCount, filters.limit);

  const cached = getCachedDeck(deckHash);
  if (cached) {
    onProgress?.(cached.movieIds.length, cached.movieIds.length);
    return { deckHash, qualifyingCount, deckSize, categories };
  }

  const candidateIds = getQualifyingMovieIds(db, filters);
  const verifiedIds = await verifyPool(candidateIds, db, onProgress);
  setCachedDeck(deckHash, { movieIds: verifiedIds, warmedAt: Date.now(), assetsReady: true });

  return { deckHash, qualifyingCount, deckSize, categories };
}

export { getCachedDeck } from "./cache.js";
