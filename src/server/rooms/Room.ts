import type Database from "better-sqlite3";
import {
  CATEGORY_LABELS,
  DECK_MIN_TO_START,
  DEFAULT_FILTERS,
  DISCONNECT_GRACE_MS,
  BUILDING_ACK_TIMEOUT_MS,
  LOBBY_FILTER_DEBOUNCE_MS,
  type CategoryOption,
  type DeckFilters,
} from "../../shared/types.js";
import { assembleMovies } from "../deck/assemble.js";
import { getCachedDeck } from "../deck/cache.js";
import { clampLimit, getQualifyingMovieIds } from "../deck/filters.js";
import { prewarmDeck } from "../deck/prewarm.js";
import { seededShuffle } from "../deck/shuffle.js";
import { plexWebUrl } from "../plex/webLink.js";
import type { AppServer } from "./ioTypes.js";
import { err, ok, type Result } from "./result.js";
import { Throttler } from "./throttle.js";
import type { PlayerInternal, RoomInternalState, RunoffCandidate } from "./types.js";

export class Room {
  readonly code: string;
  hostId: string;
  phase: RoomInternalState["phase"] = "LOBBY";
  players = new Map<string, PlayerInternal>();
  filters: DeckFilters = { ...DEFAULT_FILTERS };
  deckHash = "";
  warm: RoomInternalState["warm"] = "COLD";
  warmProgress = { done: 0, total: 0 };
  deck: RoomInternalState["deck"] = [];
  yeses = new Map<number, Set<string>>();
  runoffCandidates: RunoffCandidate[] = [];
  runoffPicks = new Map<string, string>();
  result: RoomInternalState["result"];
  createdAt = Date.now();
  lastActivityAt = Date.now();
  categories: CategoryOption[] = [];

  private lastQualifyingCount = 0;
  private readyForVoting = new Set<string>();
  private buildingTimer?: NodeJS.Timeout;
  private filterDebounceTimer?: NodeJS.Timeout;
  private recomputeToken = 0;
  private progressThrottlers = new Map<string, Throttler>();

  constructor(
    code: string,
    hostId: string,
    private readonly io: AppServer,
    private readonly db: Database.Database,
  ) {
    this.code = code;
    this.hostId = hostId;
  }

  private touch() {
    this.lastActivityAt = Date.now();
  }

  isLocked(): boolean {
    return this.phase !== "LOBBY";
  }

  toInternalState(): RoomInternalState {
    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      players: this.players,
      filters: this.filters,
      deckHash: this.deckHash,
      warm: this.warm,
      warmProgress: this.warmProgress,
      deck: this.deck,
      yeses: this.yeses,
      readyForVoting: this.readyForVoting,
      runoffCandidates: this.runoffCandidates,
      runoffPicks: this.runoffPicks,
      result: this.result,
      createdAt: this.createdAt,
      lastActivityAt: this.lastActivityAt,
    };
  }

  // ---- membership ----------------------------------------------------

  join(userId: string, name: string, viaToken: boolean): Result {
    const existing = this.players.get(userId);
    if (existing) {
      existing.connected = true;
      if (name) existing.name = name;
      if (existing.graceTimer) {
        clearTimeout(existing.graceTimer);
        existing.graceTimer = undefined;
      }
      existing.graceUntil = undefined;
      this.io.to(this.code).emit("player:presence", { id: userId, connected: true });
      this.touch();
      return ok();
    }

    if (this.isLocked() && !viaToken) return err("ERR_ROOM_LOCKED");

    const becomingHost = this.players.size === 0;
    const player: PlayerInternal = {
      id: userId,
      name: name || "Player",
      connected: true,
      isHost: becomingHost || userId === this.hostId,
      votedIndices: new Set(),
    };
    if (becomingHost) this.hostId = userId;
    this.players.set(userId, player);
    this.touch();
    return ok();
  }

  private removePlayer(userId: string, reason: "left" | "timeout") {
    const player = this.players.get(userId);
    if (!player) return;
    if (player.graceTimer) clearTimeout(player.graceTimer);
    this.players.delete(userId);
    this.progressThrottlers.delete(userId);
    this.io.to(this.code).emit("player:left", { id: userId, reason });
    this.touch();

    if (this.players.size === 0) {
      this.parkEmpty();
      return;
    }
    if (this.hostId === userId) this.reassignHost();

    if (this.phase === "VOTING") {
      const matched = this.evaluateMatches(`Matched after ${player.name} ${reason === "left" ? "left" : "dropped"}`);
      if (!matched) this.checkExhaustion();
    }
  }

  leave(userId: string) {
    this.removePlayer(userId, "left");
  }

  disconnectPlayer(userId: string) {
    const player = this.players.get(userId);
    if (!player || !player.connected) return;
    player.connected = false;
    player.graceUntil = Date.now() + DISCONNECT_GRACE_MS;
    this.io.to(this.code).emit("player:presence", { id: userId, connected: false });
    player.graceTimer = setTimeout(() => {
      const p = this.players.get(userId);
      if (!p || p.connected) return; // reconnected during the grace window
      this.removePlayer(userId, "timeout");
    }, DISCONNECT_GRACE_MS);
  }

  private reassignHost() {
    const next = this.players.values().next().value as PlayerInternal | undefined;
    if (!next) return;
    this.hostId = next.id;
    next.isHost = true;
  }

  private parkEmpty() {
    // "all players leave" -> RESOLVED (PROTOCOL §1): a locked, terminal parked
    // state rather than deleting outright; the 4h sweeper reclaims it for real.
    this.phase = "RESOLVED";
    this.touch();
  }

  // ---- lobby / filters -------------------------------------------------

  setFilters(filters: DeckFilters) {
    if (this.phase !== "LOBBY") return;
    this.filters = { ...filters, limit: clampLimit(filters.limit) };
    this.touch();
    this.scheduleFilterRecompute();
  }

  scheduleFilterRecompute(immediate = false) {
    clearTimeout(this.filterDebounceTimer);
    if (immediate) {
      void this.runFilterRecompute();
      return;
    }
    this.filterDebounceTimer = setTimeout(() => void this.runFilterRecompute(), LOBBY_FILTER_DEBOUNCE_MS);
  }

  private async runFilterRecompute() {
    const token = ++this.recomputeToken;
    this.warm = "WARMING";
    this.io.to(this.code).emit("lobby:warming", { warm: "WARMING", done: 0, total: 0 });

    const result = await prewarmDeck(this.db, this.filters, (done, total) => {
      if (token !== this.recomputeToken) return;
      this.io.to(this.code).emit("lobby:warming", { warm: "WARMING", done, total });
    });

    if (token !== this.recomputeToken) return; // superseded by a newer filter change

    this.deckHash = result.deckHash;
    this.lastQualifyingCount = result.qualifyingCount;
    this.categories = result.categories;
    this.warm = "READY";
    this.warmProgress = { done: result.deckSize, total: result.deckSize };

    this.io.to(this.code).emit("lobby:categories", result.categories);
    this.io.to(this.code).emit("lobby:preview", { deckSize: result.deckSize, category: this.filters.category });
    this.io.to(this.code).emit("lobby:warming", { warm: "READY", done: result.deckSize, total: result.deckSize });
  }

  private blameMessage(): string {
    const n = this.lastQualifyingCount;
    if ((this.filters.directors?.length ?? 0) > 0 || (this.filters.cast?.length ?? 0) > 0) {
      return `Only ${n} movies match — the director/cast filter is doing the damage. Try widening it.`;
    }
    if (this.filters.maxRuntime != null) {
      return `Only ${n} movies match — try raising the max runtime.`;
    }
    if (this.filters.category !== "ALL") {
      return `Only ${n} movies match ${CATEGORY_LABELS[this.filters.category]} with your other filters.`;
    }
    return `Only ${n} movies match your filters.`;
  }

  // ---- session lifecycle -------------------------------------------------

  async startSession(actorId: string): Promise<Result> {
    if (this.phase !== "LOBBY") return err("ERR_INVALID_PHASE");
    if (actorId !== this.hostId) return err("ERR_NOT_HOST");
    if (this.players.size < 2) return err("ERR_BAD_REQUEST", "Need at least 2 players to start.");
    if (this.lastQualifyingCount < DECK_MIN_TO_START) return err("ERR_DECK_TOO_SMALL", this.blameMessage());
    if (this.warm !== "READY") return err("ERR_DECK_COLD", "Deck is still warming — try again in a moment.");

    const cached = getCachedDeck(this.deckHash);
    const candidateIds = cached?.movieIds ?? getQualifyingMovieIds(this.db, this.filters);
    const seed = `${this.code}:${Date.now()}:${Math.random()}`;
    const shuffled = seededShuffle(candidateIds, seed).slice(0, this.filters.limit);
    this.deck = assembleMovies(this.db, shuffled);

    this.phase = "BUILDING";
    this.readyForVoting.clear();
    const assetUrls = this.deck.flatMap((m) => [m.posterUrl, ...(m.backdropUrl ? [m.backdropUrl] : [])]);
    this.io.to(this.code).emit("deck:manifest", { deckHash: this.deckHash, assetUrls });

    clearTimeout(this.buildingTimer);
    this.buildingTimer = setTimeout(() => this.dealDeck(), BUILDING_ACK_TIMEOUT_MS);
    this.touch();
    return ok();
  }

  clientReady(userId: string, deckHash: string) {
    if (this.phase !== "BUILDING" || deckHash !== this.deckHash) return;
    this.readyForVoting.add(userId);
    if (this.readyForVoting.size >= this.players.size) {
      clearTimeout(this.buildingTimer);
      this.dealDeck();
    }
  }

  private dealDeck() {
    if (this.phase !== "BUILDING") return;
    this.phase = "VOTING";
    this.yeses.clear();
    for (const p of this.players.values()) p.votedIndices.clear();
    this.touch();
    this.io.to(this.code).emit("deck:dealt", { movies: this.deck, phase: "VOTING" });
  }

  // ---- voting -------------------------------------------------------

  castVote(userId: string, idx: number, liked: boolean): Result {
    if (this.phase !== "VOTING") return err("ERR_INVALID_PHASE");
    const player = this.players.get(userId);
    if (!player) return err("ERR_BAD_REQUEST", "Not in room");
    if (idx < 0 || idx >= this.deck.length) return err("ERR_BAD_REQUEST", "Bad deck index");

    if (player.votedIndices.has(idx)) return ok(); // idempotent: duplicate vote:cast is a no-op

    player.votedIndices.add(idx);
    if (liked) {
      let set = this.yeses.get(idx);
      if (!set) {
        set = new Set();
        this.yeses.set(idx, set);
      }
      set.add(userId);
    }
    this.touch();
    this.emitProgress(player);

    const matched = this.evaluateMatches();
    if (!matched) this.checkExhaustion();
    return ok();
  }

  undoVote(userId: string, idx: number): Result {
    if (this.phase !== "VOTING") return err("ERR_INVALID_PHASE");
    const player = this.players.get(userId);
    if (!player) return err("ERR_BAD_REQUEST", "Not in room");
    if (!player.votedIndices.has(idx)) return ok();

    player.votedIndices.delete(idx);
    this.yeses.get(idx)?.delete(userId);
    this.touch();
    this.emitProgress(player);
    return ok();
  }

  private emitProgress(player: PlayerInternal) {
    let throttler = this.progressThrottlers.get(player.id);
    if (!throttler) {
      throttler = new Throttler(250);
      this.progressThrottlers.set(player.id, throttler);
    }
    throttler.run(() => {
      this.io
        .to(this.code)
        .emit("progress:update", { id: player.id, cursor: player.votedIndices.size, total: this.deck.length });
    });
  }

  cardFlip(_userId: string, _idx: number) {
    // Optional telemetry only (PROTOCOL §4) — no state change, no broadcast.
  }

  /** Set.size === connectedPlayerCount — never scans the deck except on a departure recheck. */
  private evaluateMatches(note?: string): boolean {
    if (this.phase !== "VOTING") return false;
    const quorum = this.players.size;
    if (quorum === 0) return false;

    let matchedIdx: number | undefined;
    for (const [idx, voters] of this.yeses) {
      if (voters.size === quorum && (matchedIdx === undefined || idx < matchedIdx)) {
        matchedIdx = idx;
      }
    }
    if (matchedIdx === undefined) return false;

    const movie = this.deck[matchedIdx];
    if (!movie) return false;
    const plexUrl = plexWebUrl(movie.id);
    this.result = { movie, via: "match", plexUrl };
    this.phase = "MATCHED";
    this.io.to(this.code).emit("match:found", { movie, idx: matchedIdx, note, plexUrl });
    // No client ack event is defined on the wire for MATCHED's "auto-advance" —
    // the reveal is driven entirely by match:found, so we advance immediately.
    this.phase = "RESOLVED";
    this.touch();
    return true;
  }

  private checkExhaustion() {
    if (this.phase !== "VOTING") return;
    const allExhausted = [...this.players.values()].every((p) => p.votedIndices.size >= this.deck.length);
    if (!allExhausted) return;
    this.startRunoffOrResolveEmpty();
  }

  private startRunoffOrResolveEmpty() {
    const scored = this.deck
      .map((movie, idx) => ({ movie, idx, yesCount: this.yeses.get(idx)?.size ?? 0 }))
      .filter((e) => e.yesCount > 0)
      .sort((a, b) => b.yesCount - a.yesCount || a.idx - b.idx)
      .slice(0, 5);

    this.touch();
    if (scored.length < 2) {
      this.phase = "RESOLVED";
      this.result = undefined;
      this.io.to(this.code).emit("session:resolved:empty", {
        message: "Nobody liked anything — try widening your filters.",
      });
      return;
    }

    this.runoffCandidates = scored.map((e) => ({ movie: e.movie, yesCount: e.yesCount }));
    this.runoffPicks.clear();
    this.phase = "RUNOFF";
    this.io.to(this.code).emit("runoff:start", { candidates: this.runoffCandidates });
  }

  // ---- runoff -------------------------------------------------------

  runoffPick(userId: string, movieId: string): Result {
    if (this.phase !== "RUNOFF") return err("ERR_INVALID_PHASE");
    if (!this.players.has(userId)) return err("ERR_BAD_REQUEST", "Not in room");
    if (!this.runoffCandidates.some((c) => c.movie.id === movieId)) {
      return err("ERR_BAD_REQUEST", "Not a runoff candidate");
    }
    this.runoffPicks.set(userId, movieId);
    this.touch();
    this.io.to(this.code).emit("runoff:tally", { picksIn: this.runoffPicks.size, total: this.players.size });
    if (this.runoffPicks.size >= this.players.size) this.resolveRunoff();
    return ok();
  }

  forceRunoff(actorId: string): Result {
    if (actorId !== this.hostId) return err("ERR_NOT_HOST");
    if (this.phase !== "RUNOFF") return err("ERR_INVALID_PHASE");
    this.resolveRunoff();
    return ok();
  }

  private resolveRunoff() {
    const tally = new Map<string, number>();
    for (const movieId of this.runoffPicks.values()) tally.set(movieId, (tally.get(movieId) ?? 0) + 1);

    let winner: RunoffCandidate | undefined;
    let winnerVotes = -1;
    // Candidates are already ordered by original yesCount desc / idx asc, so
    // the first max in this scan is the correct tiebreak.
    for (const c of this.runoffCandidates) {
      const votes = tally.get(c.movie.id) ?? 0;
      if (votes > winnerVotes) {
        winnerVotes = votes;
        winner = c;
      }
    }
    if (!winner) return;

    const plexUrl = plexWebUrl(winner.movie.id);
    this.result = { movie: winner.movie, via: "runoff", plexUrl };
    this.phase = "RESOLVED";
    this.touch();
    this.io.to(this.code).emit("runoff:result", { movie: winner.movie, votes: Math.max(winnerVotes, 0), plexUrl });
  }

  // ---- reset -------------------------------------------------------

  resetSession(actorId: string): Result {
    if (actorId !== this.hostId) return err("ERR_NOT_HOST");
    if (this.phase !== "RESOLVED") return err("ERR_INVALID_PHASE");

    this.phase = "LOBBY";
    this.deck = [];
    this.yeses.clear();
    this.readyForVoting.clear();
    this.runoffCandidates = [];
    this.runoffPicks.clear();
    this.result = undefined;
    for (const p of this.players.values()) p.votedIndices.clear();
    this.touch();
    this.scheduleFilterRecompute(true);
    return ok();
  }

  destroy() {
    clearTimeout(this.buildingTimer);
    clearTimeout(this.filterDebounceTimer);
    for (const p of this.players.values()) clearTimeout(p.graceTimer);
    for (const t of this.progressThrottlers.values()) t.clear();
  }
}
