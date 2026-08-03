import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FILTERS } from "../../shared/types.js";
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
    prewarmDeck: async (db: Database.Database, f: import("../../shared/types.js").DeckFilters) => {
      const qualifyingCount = filters.countQualifying(db, f);
      return {
        deckHash: deckHashMod.computeDeckHash(f, dbIndex.getLibraryVersion(db)),
        qualifyingCount,
        deckSize: Math.min(qualifyingCount, f.limit),
        categories: filters.getCategoryOptions(db, f),
      };
    },
  };
});

function fakeIo() {
  const emitted: { event: string; payload: unknown }[] = [];
  const io = {
    to: () => ({
      emit: (event: string, payload: unknown) => emitted.push({ event, payload }),
    }),
  };
  return { io: io as unknown as AppServer, emitted };
}

async function warmUp(room: InstanceType<typeof Room>, filters = { ...DEFAULT_FILTERS, limit: 10 }) {
  room.setFilters(filters);
  await vi.advanceTimersByTimeAsync(500);
}

describe("Room state machine", () => {
  let db: Database.Database;

  beforeEach(() => {
    vi.useFakeTimers();
    db = createTestDb();
    for (let i = 0; i < 10; i++) seedMovie(db);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects session:start from a non-host", async () => {
    const { io } = fakeIo();
    const room = new Room("ABCD", "host", io, db);
    room.join("host", "Host", false);
    room.join("p2", "P2", false);
    await warmUp(room);

    const result = await room.startSession("p2");
    expect(result).toEqual({ ok: false, error: "ERR_NOT_HOST", message: undefined });
  });

  it("blocks starting with fewer than 2 players", async () => {
    const { io } = fakeIo();
    const room = new Room("ABCD", "host", io, db);
    room.join("host", "Host", false);
    await warmUp(room);

    const result = await room.startSession("host");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("ERR_BAD_REQUEST");
  });

  it("blocks starting on a too-small deck with ERR_DECK_TOO_SMALL", async () => {
    const { io } = fakeIo();
    const room = new Room("ABCD", "host", io, db);
    room.join("host", "Host", false);
    room.join("p2", "P2", false);
    // Only seed 3 qualifying movies < DECK_MIN_TO_START (8).
    const tinyDb = createTestDb();
    for (let i = 0; i < 3; i++) seedMovie(tinyDb);
    const room2 = new Room("EFGH", "host", io, tinyDb);
    room2.join("host", "Host", false);
    room2.join("p2", "P2", false);
    await warmUp(room2);

    const result = await room2.startSession("host");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("ERR_DECK_TOO_SMALL");
  });

  async function buildAndDeal(room: InstanceType<typeof Room>, playerIds: string[]) {
    await warmUp(room);
    const start = await room.startSession(playerIds[0] as string);
    expect(start.ok).toBe(true);
    for (const id of playerIds) room.clientReady(id, room.deckHash);
    expect(room.phase).toBe("VOTING");
  }

  it("matches only once every connected player has voted yes (Set.size === connectedPlayerCount)", async () => {
    const { io, emitted } = fakeIo();
    const room = new Room("ABCD", "host", io, db);
    room.join("host", "Host", false);
    room.join("p2", "P2", false);
    await buildAndDeal(room, ["host", "p2"]);

    let r = room.castVote("host", 0, true);
    expect(r.ok).toBe(true);
    expect(room.phase).toBe("VOTING"); // only 1 of 2 quorum

    r = room.castVote("p2", 0, true);
    expect(r.ok).toBe(true);
    expect(room.phase).toBe("RESOLVED"); // MATCHED auto-advances immediately
    expect(room.result?.via).toBe("match");
    expect(emitted.some((e) => e.event === "match:found")).toBe(true);
  });

  it("is idempotent: a duplicate vote:cast for the same (userId, idx) is a no-op", async () => {
    const { io } = fakeIo();
    const room = new Room("ABCD", "host", io, db);
    room.join("host", "Host", false);
    room.join("p2", "P2", false);
    room.join("p3", "P3", false);
    await buildAndDeal(room, ["host", "p2", "p3"]);

    room.castVote("host", 0, true);
    room.castVote("host", 0, true); // duplicate — must not double count
    expect(room.yeses.get(0)?.size).toBe(1);

    room.castVote("p2", 0, true);
    expect(room.phase).toBe("VOTING"); // still short of quorum 3

    room.castVote("p3", 0, true);
    expect(room.phase).toBe("RESOLVED");
  });

  it("does not decrement quorum immediately on disconnect, only after the grace window — and rechecks matches on departure", async () => {
    const { io, emitted } = fakeIo();
    const room = new Room("ABCD", "host", io, db);
    room.join("host", "Host", false);
    room.join("p2", "P2", false);
    room.join("p3", "P3", false);
    await buildAndDeal(room, ["host", "p2", "p3"]);

    room.castVote("host", 0, true);
    room.castVote("p2", 0, true);
    expect(room.phase).toBe("VOTING"); // 2 of 3 — p3 hasn't voted

    room.disconnectPlayer("p3");
    // Quorum must NOT drop yet — matching against 2 remaining would be a stale-vote bug.
    expect(room.phase).toBe("VOTING");
    expect(room.players.size).toBe(3);

    await vi.advanceTimersByTimeAsync(90_000); // DISCONNECT_GRACE_MS elapses
    expect(room.players.size).toBe(2);
    expect(room.phase).toBe("RESOLVED"); // departure completed the match
    expect(room.result?.movie.id).toBeDefined();
    const matchEvent = emitted.find((e) => e.event === "match:found") as { payload: { note?: string } } | undefined;
    expect(matchEvent?.payload.note).toMatch(/dropped/);
  });

  it("reconnecting during the grace window cancels the pending removal", async () => {
    const { io } = fakeIo();
    const room = new Room("ABCD", "host", io, db);
    room.join("host", "Host", false);
    room.join("p2", "P2", false);

    room.disconnectPlayer("p2");
    await vi.advanceTimersByTimeAsync(50_000); // well under the 90s grace window
    room.join("p2", "P2", true); // reconnect

    await vi.advanceTimersByTimeAsync(90_000);
    expect(room.players.has("p2")).toBe(true);
    expect(room.players.get("p2")?.connected).toBe(true);
  });

  it("runoff: top candidates by yesCount, tiebreak by lower deck index, then plurality pick wins", async () => {
    const { io, emitted } = fakeIo();
    const smallDb = createTestDb();
    for (let i = 0; i < 8; i++) seedMovie(smallDb);
    const room = new Room("ABCD", "host", io, smallDb);
    room.join("host", "Host", false);
    room.join("p2", "P2", false);
    await buildAndDeal(room, ["host", "p2"]);

    // Session shuffles the deck, so read back actual dealt order rather than
    // assuming it matches insertion order.
    const winnerId = room.deck[0]!.id;
    const runnerUpId = room.deck[1]!.id;

    // Nobody agrees on anything (no unanimous match), but 2 movies get 1 yes each.
    room.castVote("host", 0, true);
    room.castVote("p2", 0, false);
    room.castVote("host", 1, false);
    room.castVote("p2", 1, true);
    for (let i = 2; i < 8; i++) {
      room.castVote("host", i, false);
      room.castVote("p2", i, false);
    }

    expect(room.phase).toBe("RUNOFF");
    expect(room.runoffCandidates.map((c) => c.movie.id)).toEqual([winnerId, runnerUpId]);

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
    for (let i = 0; i < 8; i++) seedMovie(smallDb);
    const room = new Room("ABCD", "host", io, smallDb);
    room.join("host", "Host", false);
    room.join("p2", "P2", false);
    await buildAndDeal(room, ["host", "p2"]);

    for (let i = 0; i < 8; i++) {
      room.castVote("host", i, false);
      room.castVote("p2", i, false);
    }

    expect(room.phase).toBe("RESOLVED");
    expect(room.result).toBeUndefined();
    expect(emitted.some((e) => e.event === "session:resolved:empty")).toBe(true);
  });

  it("session:reset returns to LOBBY, host-only, keeps players and filters", async () => {
    const { io } = fakeIo();
    const smallDb = createTestDb();
    for (let i = 0; i < 8; i++) seedMovie(smallDb);
    const room = new Room("ABCD", "host", io, smallDb);
    room.join("host", "Host", false);
    room.join("p2", "P2", false);
    await buildAndDeal(room, ["host", "p2"]);
    for (let i = 0; i < 8; i++) {
      room.castVote("host", i, false);
      room.castVote("p2", i, false);
    }
    expect(room.phase).toBe("RESOLVED");

    const denied = room.resetSession("p2");
    expect(denied).toEqual({ ok: false, error: "ERR_NOT_HOST", message: undefined });

    const ok = room.resetSession("host");
    expect(ok.ok).toBe(true);
    expect(room.phase).toBe("LOBBY");
    expect(room.players.size).toBe(2);
    expect(room.deck).toHaveLength(0);
  });
});
