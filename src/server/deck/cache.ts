export type CachedDeck = {
  movieIds: string[]; // qualifying set, pre-shuffle — order is per-session
  warmedAt: number;
  assetsReady: boolean;
};

// Keyed by deckHash (filters + libraryVersion), so a stale entry just stops
// being addressed once the library changes rather than needing eviction.
const cache = new Map<string, CachedDeck>();

export function getCachedDeck(hash: string): CachedDeck | undefined {
  return cache.get(hash);
}

export function setCachedDeck(hash: string, deck: CachedDeck): void {
  cache.set(hash, deck);
}
