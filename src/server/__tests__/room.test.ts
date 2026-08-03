import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppServer } from "../rooms/ioTypes.js";
import { Room } from "../rooms/Room.js";
import { createTestDb, seedMovie } from "./testDb.js";

// Bypass real Plex/filesystem work: reimplement prewarm using the real,
// pure-SQL filter functions so warm state and counts behave for real while
// staying network/disk-free in tests.
vi.mock("../deck/prewarm.js", async () => {
  const filters = await import("../deck/filters.js");
  const dbIndex = await import("../db/index.js");
  const deckHashMod = await import("../deck/deckHash.js");
  return {
    prewarmDeck: async (
      db: Database.Database,
      f: import("../../shared/types.js").DeckFilters,
      categories: import("../../shared/types.js").CategoryId[],
    ) => {
      const qualifyingCount = filters.countQualifying(db, f, categories);
      return {
        deckHash: deckHashMod.computeDeckHash(f, categories, dbIndex.getLibraryVersion(db)),
        qualifyingCount,
        deckSize: qualifyingCount,
        categories: filters.getCategoryOptions(db, f),
      };
    },
  };
});

type EmittedEvent = { target: string; event: string; payload: unknown };

function fakeIo() {
  const emitted: EmittedEvent[] = [];
  const io = {
    to: (target: string) => ({
      emit: (event: string, payload: unknown) => emitted.push({ target, event, payload }),
    }),
  };
  return { io: io as unknown as AppServer, emitted };
}

function joinPlayer(room: Room, userId: string, name: string, viaToken = false) {
  const result = room.join(userId, name, viaToken);
  room.setSocketId(userId, `socket-${userId}`);
  return result;
}

function emitsFor(emitted: EmittedEvent[], userId: string, event: string) {
  return emitted.filter((e) => e.target === `socket-${userId}` && e.event === event);
}

function deckHashFor(emitted: EmittedEvent[], userId: string): string {
  const last = emitsFor(emitted, userId, "deck:manifest").at(-1);
  return (last?.payload as { deckHash: string } | undefined)?.deckHash ?? "";
}

async function warmUp(room: Room) {
  await vi.advanceTimersByTimeAsync(500);
}

async function buildAndDeal(room: Room, playerIds: string[], emitted: EmittedEvent[]) {
  await warmUp(room);
  const start = await room.startSession(playerIds[0] as string);
  expect(start.ok).toBe(true);
  for (const id of playerIds) room.clientReady(id, deckHashFor(emitted, id));
  expect(room.phase).toBe("VOTING");
}

describe("Room state machine", () => {
  let db: Database.Database;
  let ids: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    db = createTestDb();
    ids = Array.from({ length: 10 }, () => seedMovie(db));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects session:start from a non-host", async () => {
    const { io } = fakeIo();
    const room = new Room("ABCD", "host", io, db);
    joinPlayer(room, "host", "Host");
    joinPlayer(room, "p2", "P2");
    await warmUp(room);

    const result = await room.startSession("p2");
    expect(result).toEqual({ ok: false, error: "ERR_NOT_HOST", message: undefined });
  });

  it("blocks starting with fewer than 2 players", async () => {
    const { io } = fakeIo();
    const room = new Room("ABCD", "host", io, db);
    joinPlayer(room, "host", "Host");
    await warmUp(room);

    const result = await room.startSession("host");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("ERR_BAD_REQUEST");
  });

  it("blocks starting on a too-small deck with ERR_DECK_TOO_SMALL", async () => {
    const { io } = fakeIo();
    const tinyDb = createTestDb();
    for (let i = 0; i < 3; i++) seedMovie(tinyDb);
    const room = new Room("EFGH", "host", io, tinyDb);
    joinPlayer(room, "host", "Host");
    joinPlayer(room, "p2", "P2");
    await warmUp(room);

    const result = await room.startSession("host");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("ERR_DECK_TOO_SMALL");
  });

  it("matches only once every connected player has voted yes (Set.size === connectedPlayerCount)", async () => {
    const { io, emitted } = fakeIo();
    const room = new Room("ABCD", "host", io, db);
    joinPlayer(room, "host", "Host");
    joinPlayer(room, "p2", "P2");
    await buildAndDeal(room, ["host", "p2"], emitted);

    const target = ids[0] as string;
    let r = room.castVote("host", target, true);
    expect(r.ok).toBe(true);
    expect(room.phase).toBe("VOTING"); // only 1 of 2 quorum

    r = room.castVote("p2", target, true);
    expect(r.ok).toBe(true);
    expect(room.phase).toBe("RESOLVED"); // MATCHED auto-advances immediately
    expect(room.result?.via).toBe("match");
    expect(emitted.some((e) => e.event === "match:found")).toBe(true);
  });

  it("is idempotent: a duplicate vote:cast for the same (userId, movieId) is a no-op", async () => {
    const { io, emitted } = fakeIo();
    const room = new Room("ABCD", "host", io, db);
    joinPlayer(room, "host", "Host");
    joinPlayer(room, "p2", "P2");
    joinPlayer(room, "p3", "P3");
    await buildAndDeal(room, ["host", "p2", "p3"], emitted);

    const target = ids[0] as string;
    room.castVote("host", target, true);
    room.castVote("host", target, true); // duplicate — must not double count
    expect(room.yeses.get(target)?.size).toBe(1);

    room.castVote("p2", target, true);
    expect(room.phase).toBe("VOTING"); // still short of quorum 3

    room.castVote("p3", target, true);
    expect(room.phase).toBe("RESOLVED");
  });

  it("rejects a vote for a movie not in that player's own deck", async () => {
    const { io, emitted } = fakeIo();
    const room = new Room("ABCD", "host", io, db);
    joinPlayer(room, "host", "Host");
    joinPlayer(room, "p2", "P2");
    await buildAndDeal(room, ["host", "p2"], emitted);

    const result = room.castVote("host", "not-a-real-movie-id", true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("ERR_BAD_REQUEST");
  });

  it("does not decrement quorum immediately on disconnect, only after the grace window — and rechecks matches on departure", async () => {
    const { io, emitted } = fakeIo();
    const room = new Room("ABCD", "host", io, db);
    joinPlayer(room, "host", "Host");
    joinPlayer(room, "p2", "P2");
    joinPlayer(room, "p3", "P3");
    await buildAndDeal(room, ["host", "p2", "p3"], emitted);

    const target = ids[0] as string;
    room.castVote("host", target, true);
    room.castVote("p2", target, true);
    expect(room.phase).toBe("VOTING"); // 2 of 3 — p3 hasn't voted

    room.disconnectPlayer("p3");
    // Quorum must NOT drop yet — matching against 2 remaining would be a stale-vote bug.
    expect(room.phase).toBe("VOTING");
    expect(room.players.size).toBe(3);

    await vi.advanceTimersByTimeAsync(90_000); // DISCONNECT_GRACE_MS elapses
    expect(room.players.size).toBe(2);
    expect(room.phase).toBe("RESOLVED"); // departure completed the match
    expect(room.result?.movie.id).toBe(target);
    const matchEvent = emitted.find((e) => e.event === "match:found") as { payload: { note?: string } } | undefined;
    expect(matchEvent?.payload.note).toMatch(/dropped/);
  });

  it("reconnecting during the grace window cancels the pending removal", async () => {
    const { io } = fakeIo();
    const room = new Room("ABCD", "host", io, db);
    joinPlayer(room, "host", "Host");
    joinPlayer(room, "p2", "P2");

    room.disconnectPlayer("p2");
    await vi.advanceTimersByTimeAsync(50_000); // well under the 90s grace window
    joinPlayer(room, "p2", "P2", true); // reconnect

    await vi.advanceTimersByTimeAsync(90_000);
    expect(room.players.has("p2")).toBe(true);
    expect(room.players.get("p2")?.connected).toBe(true);
  });

  it("runoff: top candidates by yesCount, tiebreak deterministic, then plurality pick wins", async () => {
    const { io, emitted } = fakeIo();
    const smallDb = createTestDb();
    const smallIds = Array.from({ length: 8 }, () => seedMovie(smallDb));
    const room = new Room("ABCD", "host", io, smallDb);
    joinPlayer(room, "host", "Host");
    joinPlayer(room, "p2", "P2");
    await buildAndDeal(room, ["host", "p2"], emitted);

    // Nobody agrees on anything (no unanimous match), but 2 movies get 1 yes each.
    const [winnerId, runnerUpId] = smallIds as [string, string];
    room.castVote("host", winnerId, true);
    room.castVote("p2", winnerId, false);
    room.castVote("host", runnerUpId, false);
    room.castVote("p2", runnerUpId, true);
    for (let i = 2; i < smallIds.length; i++) {
      room.castVote("host", smallIds[i] as string, false);
      room.castVote("p2", smallIds[i] as string, false);
    }

    expect(room.phase).toBe("RUNOFF");
    expect(room.runoffCandidates.map((c) => c.movie.id).sort()).toEqual([winnerId, runnerUpId].sort());

    room.runoffPick("host", winnerId);
    room.runoffPick("p2", winnerId);
    expect(room.phase).toBe("RESOLVED");
    expect(room.result?.via).toBe("runoff");
    expect(room.result?.movie.id).toBe(winnerId);
    expect(emitted.some((e) => e.event === "runoff:result")).toBe(true);
  });

  it("skips the runoff and resolves empty when fewer than 2 movies got any yes", async () => {
    const { io, emitted } = fakeIo();
    const smallDb = createTestDb();
    const smallIds = Array.from({ length: 8 }, () => seedMovie(smallDb));
    const room = new Room("ABCD", "host", io, smallDb);
    joinPlayer(room, "host", "Host");
    joinPlayer(room, "p2", "P2");
    await buildAndDeal(room, ["host", "p2"], emitted);

    for (const id of smallIds) {
      room.castVote("host", id, false);
      room.castVote("p2", id, false);
    }

    expect(room.phase).toBe("RESOLVED");
    expect(room.result).toBeUndefined();
    expect(emitted.some((e) => e.event === "session:resolved:empty")).toBe(true);
  });

  it("session:reset returns to LOBBY, host-only, keeps players and filters", async () => {
    const { io, emitted } = fakeIo();
    const smallDb = createTestDb();
    const smallIds = Array.from({ length: 8 }, () => seedMovie(smallDb));
    const room = new Room("ABCD", "host", io, smallDb);
    joinPlayer(room, "host", "Host");
    joinPlayer(room, "p2", "P2");
    await buildAndDeal(room, ["host", "p2"], emitted);
    for (const id of smallIds) {
      room.castVote("host", id, false);
      room.castVote("p2", id, false);
    }
    expect(room.phase).toBe("RESOLVED");

    const denied = room.resetSession("p2");
    expect(denied).toEqual({ ok: false, error: "ERR_NOT_HOST", message: undefined });

    const okResult = room.resetSession("host");
    expect(okResult.ok).toBe(true);
    expect(room.phase).toBe("LOBBY");
    expect(room.players.size).toBe(2);
    expect(room.playerDecks.size).toBe(0);
  });

  describe("genre picks", () => {
    it("SHARED mode: everyone's picks OR-combine into one deck", async () => {
      const { io } = fakeIo();
      const mixedDb = createTestDb();
      const comedyIds = Array.from({ length: 5 }, () => seedMovie(mixedDb, { categories: ["COMEDY"] }));
      const horrorIds = Array.from({ length: 5 }, () => seedMovie(mixedDb, { categories: ["HORROR"] }));
      seedMovie(mixedDb, { categories: ["DRAMA"] }); // picked by nobody — must be excluded

      const room = new Room("ABCD", "host", io, mixedDb);
      joinPlayer(room, "host", "Host");
      joinPlayer(room, "p2", "P2");
      room.setGenrePicks("host", ["COMEDY"]);
      room.setGenrePicks("p2", ["HORROR"]);
      await warmUp(room);

      const start = await room.startSession("host");
      expect(start.ok).toBe(true);
      await vi.advanceTimersByTimeAsync(10);

      const hostDeckIds = new Set(room.playerDecks.get("host")?.map((m) => m.id));
      expect(hostDeckIds.size).toBe(10);
      for (const id of [...comedyIds, ...horrorIds]) expect(hostDeckIds.has(id)).toBe(true);
    });

    it("PERSONAL mode: each player's deck reflects only their own picks", async () => {
      const { io } = fakeIo();
      const mixedDb = createTestDb();
      const comedyIds = Array.from({ length: 8 }, () => seedMovie(mixedDb, { categories: ["COMEDY"] }));
      const horrorIds = Array.from({ length: 8 }, () => seedMovie(mixedDb, { categories: ["HORROR"] }));

      const room = new Room("ABCD", "host", io, mixedDb);
      joinPlayer(room, "host", "Host");
      joinPlayer(room, "p2", "P2");
      const modeResult = room.setGenreMode("host", "PERSONAL");
      expect(modeResult.ok).toBe(true);
      room.setGenrePicks("host", ["COMEDY"]);
      room.setGenrePicks("p2", ["HORROR"]);
      await warmUp(room);

      const start = await room.startSession("host");
      expect(start.ok).toBe(true);
      await vi.advanceTimersByTimeAsync(10);

      const hostDeckIds = room.playerDecks.get("host")?.map((m) => m.id).sort();
      const p2DeckIds = room.playerDecks.get("p2")?.map((m) => m.id).sort();
      expect(hostDeckIds).toEqual([...comedyIds].sort());
      expect(p2DeckIds).toEqual([...horrorIds].sort());
    });

    it("only the host can change genreMode", async () => {
      const { io } = fakeIo();
      const room = new Room("ABCD", "host", io, db);
      joinPlayer(room, "host", "Host");
      joinPlayer(room, "p2", "P2");

      const result = room.setGenreMode("p2", "PERSONAL");
      expect(result).toEqual({ ok: false, error: "ERR_NOT_HOST", message: undefined });
      expect(room.genreMode).toBe("SHARED");
    });
  });
});
