import { createHash } from "node:crypto";
import type { CategoryId, DeckFilters } from "../../shared/types.js";
import { canonicalizeFilters } from "./filters.js";

/** sha1(canonicalize(filters+categories) + libraryVersion) — a nightly ingest bump invalidates every cached deck for free. */
export function computeDeckHash(filters: DeckFilters, categories: CategoryId[], libraryVersion: number): string {
  return createHash("sha1").update(`${canonicalizeFilters(filters, categories)}:${libraryVersion}`).digest("hex");
}
