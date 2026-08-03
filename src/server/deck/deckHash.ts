import { createHash } from "node:crypto";
import type { CategoryId, DeckFilters } from "../../shared/types.js";
import { canonicalizeFilters } from "./filters.js";

/** sha1(canonicalize(filters+categoryGroups) + libraryVersion) — a nightly ingest bump invalidates every cached deck for free. */
export function computeDeckHash(filters: DeckFilters, categoryGroups: CategoryId[][], libraryVersion: number): string {
  return createHash("sha1").update(`${canonicalizeFilters(filters, categoryGroups)}:${libraryVersion}`).digest("hex");
}
