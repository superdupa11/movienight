import { describe, expect, it } from "vitest";
import { mapGenresToCategories } from "../plex/categoryMap.js";

describe("mapGenresToCategories", () => {
  it("maps messy Plex tags onto the curated set", () => {
    expect(mapGenresToCategories(["Sci-Fi"])).toEqual(["SCIFI_FANTASY"]);
    expect(mapGenresToCategories(["Science Fiction"])).toEqual(["SCIFI_FANTASY"]);
  });

  it("lets a movie land in multiple categories (rom-com case)", () => {
    const cats = mapGenresToCategories(["Comedy", "Romance"]);
    expect(cats).toContain("COMEDY");
    expect(cats).toContain("ROMANCE");
    expect(cats).toHaveLength(2);
  });

  it("dedupes when two raw tags map to the same category", () => {
    expect(mapGenresToCategories(["Thriller", "Mystery", "Crime"])).toEqual(["THRILLER"]);
  });

  it("drops unknown tags silently rather than inventing a category", () => {
    expect(mapGenresToCategories(["Some Obscure One-Off Tag"])).toEqual([]);
  });

  it("is case-insensitive", () => {
    expect(mapGenresToCategories(["comedy"])).toEqual(["COMEDY"]);
  });
});
