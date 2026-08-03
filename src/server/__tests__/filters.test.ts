import type Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_FILTERS } from "../../shared/types.js";
import { setMoviePeople, upsertPerson } from "../db/people.js";
import { canonicalizeFilters, clampLimit, countQualifying, getCategoryOptions, getQualifyingMovieIds } from "../deck/filters.js";
import { createTestDb, seedMovie } from "./testDb.js";

describe("deck filters", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("ALL skips the category filter entirely", () => {
    seedMovie(db, { categories: ["COMEDY"] });
    seedMovie(db, { categories: ["HORROR"] });
    expect(countQualifying(db, { ...DEFAULT_FILTERS, category: "ALL" })).toBe(2);
  });

  it("filters by category and excludes broken-art (has_poster=0) rows", () => {
    seedMovie(db, { categories: ["COMEDY"] });
    const brokenId = seedMovie(db, { categories: ["COMEDY"] });
    db.prepare("UPDATE movies SET has_poster = 0 WHERE id = ?").run(brokenId);

    expect(countQualifying(db, { ...DEFAULT_FILTERS, category: "COMEDY" })).toBe(1);
  });

  it("a movie in multiple categories qualifies under either", () => {
    seedMovie(db, { categories: ["COMEDY", "ROMANCE"] });
    expect(countQualifying(db, { ...DEFAULT_FILTERS, category: "COMEDY" })).toBe(1);
    expect(countQualifying(db, { ...DEFAULT_FILTERS, category: "ROMANCE" })).toBe(1);
  });

  it("directors: OR within the facet", () => {
    const fincher = upsertPerson(db, { tagId: 1, name: "David Fincher" });
    const nolan = upsertPerson(db, { tagId: 2, name: "Christopher Nolan" });
    const m1 = seedMovie(db);
    const m2 = seedMovie(db);
    seedMovie(db); // no director credit, should never qualify
    setMoviePeople(db, m1, "DIRECTOR", [{ personId: fincher }]);
    setMoviePeople(db, m2, "DIRECTOR", [{ personId: nolan }]);

    const ids = getQualifyingMovieIds(db, { ...DEFAULT_FILTERS, category: "ALL", directors: [fincher, nolan] });
    expect(new Set(ids)).toEqual(new Set([m1, m2]));
  });

  it("director + category: AND across facets", () => {
    const fincher = upsertPerson(db, { tagId: 1, name: "David Fincher" });
    const m1 = seedMovie(db, { categories: ["THRILLER"] });
    const m2 = seedMovie(db, { categories: ["COMEDY"] });
    setMoviePeople(db, m1, "DIRECTOR", [{ personId: fincher }]);
    setMoviePeople(db, m2, "DIRECTOR", [{ personId: fincher }]);

    const ids = getQualifyingMovieIds(db, { ...DEFAULT_FILTERS, category: "THRILLER", directors: [fincher] });
    expect(ids).toEqual([m1]);
  });

  it("maxRuntime excludes longer movies (and zero-runtime junk)", () => {
    const short = seedMovie(db, { runtime: 90 });
    seedMovie(db, { runtime: 150 });
    seedMovie(db, { runtime: 0 });

    const ids = getQualifyingMovieIds(db, { ...DEFAULT_FILTERS, category: "ALL", maxRuntime: 100 });
    expect(ids).toEqual([short]);
  });

  it("unwatchedOnly filters on viewCount", () => {
    seedMovie(db, { viewCount: 0 });
    seedMovie(db, { viewCount: 3 });
    expect(countQualifying(db, { ...DEFAULT_FILTERS, category: "ALL", unwatchedOnly: true })).toBe(1);
  });

  it("category chip counts are computed against every OTHER active filter, not the category itself", () => {
    // Two comedies, one of which is also unwatched.
    seedMovie(db, { categories: ["COMEDY"], viewCount: 0 });
    seedMovie(db, { categories: ["COMEDY"], viewCount: 5 });
    seedMovie(db, { categories: ["HORROR"], viewCount: 0 });

    const options = getCategoryOptions(db, { ...DEFAULT_FILTERS, category: "ALL", unwatchedOnly: true });
    const comedy = options.find((o) => o.id === "COMEDY")!;
    const horror = options.find((o) => o.id === "HORROR")!;
    expect(comedy.count).toBe(1); // unwatchedOnly still applies
    expect(horror.count).toBe(1);
  });

  it("canonicalizeFilters is stable regardless of array order", () => {
    const a = canonicalizeFilters({ ...DEFAULT_FILTERS, directors: [3, 1, 2] });
    const b = canonicalizeFilters({ ...DEFAULT_FILTERS, directors: [1, 2, 3] });
    expect(a).toBe(b);
  });

  it("clampLimit enforces the [1, 100] range and defaults to 40", () => {
    expect(clampLimit(undefined)).toBe(40);
    expect(clampLimit(0)).toBe(40);
    expect(clampLimit(500)).toBe(100);
    expect(clampLimit(-5)).toBe(1);
    expect(clampLimit(55)).toBe(55);
  });
});
