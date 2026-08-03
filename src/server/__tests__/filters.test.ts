import type Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_FILTERS } from "../../shared/types.js";
import { setMoviePeople, upsertPerson } from "../db/people.js";
import { canonicalizeFilters, countQualifying, getCategoryOptions, getQualifyingMovieIds } from "../deck/filters.js";
import { createTestDb, seedMovie } from "./testDb.js";

describe("deck filters", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("empty categories array skips the genre filter entirely (any genre)", () => {
    seedMovie(db, { categories: ["COMEDY"] });
    seedMovie(db, { categories: ["HORROR"] });
    expect(countQualifying(db, DEFAULT_FILTERS, [])).toBe(2);
  });

  it("filters by category and excludes broken-art (has_poster=0) rows", () => {
    seedMovie(db, { categories: ["COMEDY"] });
    const brokenId = seedMovie(db, { categories: ["COMEDY"] });
    db.prepare("UPDATE movies SET has_poster = 0 WHERE id = ?").run(brokenId);

    expect(countQualifying(db, DEFAULT_FILTERS, ["COMEDY"])).toBe(1);
  });

  it("multi-select categories are OR-combined", () => {
    seedMovie(db, { categories: ["COMEDY"] });
    seedMovie(db, { categories: ["HORROR"] });
    seedMovie(db, { categories: ["DRAMA"] });
    expect(countQualifying(db, DEFAULT_FILTERS, ["COMEDY", "HORROR"])).toBe(2);
  });

  it("a movie in multiple categories qualifies under either", () => {
    seedMovie(db, { categories: ["COMEDY", "ROMANCE"] });
    expect(countQualifying(db, DEFAULT_FILTERS, ["COMEDY"])).toBe(1);
    expect(countQualifying(db, DEFAULT_FILTERS, ["ROMANCE"])).toBe(1);
  });

  it("directors: OR within the facet", () => {
    const fincher = upsertPerson(db, { tagId: 1, name: "David Fincher" });
    const nolan = upsertPerson(db, { tagId: 2, name: "Christopher Nolan" });
    const m1 = seedMovie(db);
    const m2 = seedMovie(db);
    seedMovie(db); // no director credit, should never qualify
    setMoviePeople(db, m1, "DIRECTOR", [{ personId: fincher }]);
    setMoviePeople(db, m2, "DIRECTOR", [{ personId: nolan }]);

    const ids = getQualifyingMovieIds(db, { ...DEFAULT_FILTERS, directors: [fincher, nolan] }, []);
    expect(new Set(ids)).toEqual(new Set([m1, m2]));
  });

  it("director + category: AND across facets", () => {
    const fincher = upsertPerson(db, { tagId: 1, name: "David Fincher" });
    const m1 = seedMovie(db, { categories: ["THRILLER"] });
    const m2 = seedMovie(db, { categories: ["COMEDY"] });
    setMoviePeople(db, m1, "DIRECTOR", [{ personId: fincher }]);
    setMoviePeople(db, m2, "DIRECTOR", [{ personId: fincher }]);

    const ids = getQualifyingMovieIds(db, { ...DEFAULT_FILTERS, directors: [fincher] }, ["THRILLER"]);
    expect(ids).toEqual([m1]);
  });

  it("maxRuntime excludes longer movies (and zero-runtime junk)", () => {
    const short = seedMovie(db, { runtime: 90 });
    seedMovie(db, { runtime: 150 });
    seedMovie(db, { runtime: 0 });

    const ids = getQualifyingMovieIds(db, { ...DEFAULT_FILTERS, maxRuntime: 100 }, []);
    expect(ids).toEqual([short]);
  });

  it("unwatchedOnly filters on viewCount", () => {
    seedMovie(db, { viewCount: 0 });
    seedMovie(db, { viewCount: 3 });
    expect(countQualifying(db, { ...DEFAULT_FILTERS, unwatchedOnly: true }, [])).toBe(1);
  });

  it("category chip counts reflect only the host-controlled filters, independent of other selected genres", () => {
    seedMovie(db, { categories: ["COMEDY"], viewCount: 0 });
    seedMovie(db, { categories: ["COMEDY"], viewCount: 5 });
    seedMovie(db, { categories: ["HORROR"], viewCount: 0 });

    const options = getCategoryOptions(db, { ...DEFAULT_FILTERS, unwatchedOnly: true });
    const comedy = options.find((o) => o.id === "COMEDY")!;
    const horror = options.find((o) => o.id === "HORROR")!;
    expect(comedy.count).toBe(1); // unwatchedOnly still applies
    expect(horror.count).toBe(1);
  });

  it("canonicalizeFilters is stable regardless of array order", () => {
    const a = canonicalizeFilters({ ...DEFAULT_FILTERS, directors: [3, 1, 2] }, ["HORROR", "COMEDY"]);
    const b = canonicalizeFilters({ ...DEFAULT_FILTERS, directors: [1, 2, 3] }, ["COMEDY", "HORROR"]);
    expect(a).toBe(b);
  });

  it("canonicalizeFilters differs when categories differ", () => {
    const a = canonicalizeFilters(DEFAULT_FILTERS, ["COMEDY"]);
    const b = canonicalizeFilters(DEFAULT_FILTERS, ["HORROR"]);
    expect(a).not.toBe(b);
  });
});
