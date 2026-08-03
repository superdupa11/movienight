import type { CategoryId } from "../../shared/types.js";

// PROTOCOL §3 — matching is OR across tags; a movie can land in multiple
// categories on purpose (a rom-com surfaces under both COMEDY and ROMANCE).
const CATEGORY_TAGS: Record<CategoryId, string[]> = {
  COMEDY: ["Comedy", "Stand-up Comedy", "Parody"],
  ROMANCE: ["Romance", "Romantic Comedy"],
  ACTION: ["Action", "Adventure", "War", "Martial Arts"],
  HORROR: ["Horror", "Slasher"],
  SCIFI_FANTASY: ["Science Fiction", "Sci-Fi", "Fantasy"],
  THRILLER: ["Thriller", "Mystery", "Crime", "Suspense"],
  DRAMA: ["Drama", "Biography", "History"],
  FAMILY: ["Animation", "Family", "Children"],
  DOCUMENTARY: ["Documentary"],
};

const TAG_TO_CATEGORIES = new Map<string, CategoryId[]>();
for (const [category, tags] of Object.entries(CATEGORY_TAGS) as [CategoryId, string[]][]) {
  for (const tag of tags) {
    const key = tag.toLowerCase();
    const existing = TAG_TO_CATEGORIES.get(key);
    if (existing) existing.push(category);
    else TAG_TO_CATEGORIES.set(key, [category]);
  }
}

export function mapGenresToCategories(genres: string[]): CategoryId[] {
  const set = new Set<CategoryId>();
  for (const genre of genres) {
    for (const category of TAG_TO_CATEGORIES.get(genre.toLowerCase()) ?? []) set.add(category);
  }
  return [...set];
}
