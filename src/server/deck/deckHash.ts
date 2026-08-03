import { createHash } from "node:crypto";
import type { DeckFilters } from "../../shared/types.js";
import { canonicalizeFilters } from "./filters.js";

/** sha1(canonicalize(filters) + libraryVersion) — a nightly ingest bump invalidates every cached deck for free. */
export function computeDeckHash(filters: DeckFilters, libraryVersion: number): string {
  return createHash("sha1").update(`${canonicalizeFilters(filters)}:${libraryVersion}`).digest("hex");
}
