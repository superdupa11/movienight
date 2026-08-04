import type Database from "better-sqlite3";
import {
  CATEGORY_IDS,
  DECK_MIN_TO_START,
  DEFAULT_FILTERS,
  DISCONNECT_GRACE_MS,
  BUILDING_ACK_TIMEOUT_MS,
  LOBBY_FILTER_DEBOUNCE_MS,
  type CategoryId,
  type CategoryOption,
  type DeckFilters,
  type GenreMode,
  type Movie,
  type RoomStateDTO,
  type ServerToClientEvents,
  type WarmState,
} from "../../shared/types.js";
import { assembleMovies } from "../deck/assemble.js";
import { getCachedDeck } from "../deck/cache.js";
import { getCategoryOptions, getQualifyingMovieIds } from "../deck/filters.js";
import { prewarmDeck } from "../deck/prewarm.js";
import { seededShuffle } from "../deck/shuffle.js";
import { config } from "../config.js";
import { plexWebUrl } from "../plex/webLink.js";
import type { AppServer } from "./ioTypes.js";
import { err, ok, type Result } from "./result.js";
import { Throttler } from "./throttle.js";
import type { PlayerInternal, RunoffCandidate } from "./types.js";

type WarmSnapshot = { warm: WarmState; warmProgress: { done: number; total: number }; deckHash: string; qualifyingCount: number; deckSize: number };

export class Room {
  readonly code: string;
  hostId: string;
  phase: RoomStateDTO["phase"] = "LOBBY";
  players = new Map<string, PlayerInternal>();
  filters: DeckFilters = { ...DEFAULT_FILTERS };
  genreMode: GenreMode = "SHARED";
  genrePicks = new Map<string, CategoryId[]>(); // userId -> their own picks
  categories: CategoryOption[] = []; // global chip counts, mode-independent

  playerDecks = new Map<string, Movie[]>();
  private playerDeckIds = new Map<string, Set<string>>(); // O(1) "is movieId in my deck" checks
  movieById = new Map<string, Movie>(); // union across every dealt deck, for match/runoff broadcasts

  yeses = new Map<string, Set<string>>(); // movieId -> voter userIds
  runoffCandidates: RunoffCandidate[] = [];
  runoffPicks = new Map<string, string>(); // userId -> movieId
  result?: RoomStateDTO["result"];
  createdAt = Date.now();
  lastActivityAt = Date.now();

  // SHARED mode: one canonical set of values for the whole room.
  private shared: WarmSnapshot = { warm: "COLD", warmProgress: { done: 0, total: 0 }, deckHash: "", qualifyingCount: 0, deckSize: 0 };
  private sharedCategoryGroups: CategoryId[][] = [];
  // PERSONAL mode: independently tracked per player.
  private personal = new Map<string, WarmSnapshot>();
  private personalCategories = new Map<string, CategoryId[]>();

  private readyForVoting = new Set<string>();
  private buildingTimer?: NodeJS.Timeout;
  private filterDebounceTimer?: NodeJS.Timeout;
  private recomputeToken = 0;
  private progressThrottlers = new Map<string, Throttler>();
  private nextGuestNumber = 1; // monotonic — never reused, even if an earlier guest leaves

  constructor(
    code: string,
    hostId: string,
    private readonly io: AppServer,
    private readonly db: Database.Database,
    public solo: boolean = false,
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

  private emitToPlayer<K extends keyof ServerToClientEvents>(
    userId: string,
    event: K,
    payload: Parameters<ServerToClientEvents[K]>[0],
  ) {
    const player = this.players.get(userId);
    if (player?.socketId) (this.io.to(player.socketId).emit as (e: K, p: typeof payload) => void)(event, payload);
  }

  setSocketId(userId: string, socketId: string) {
    const player = this.players.get(userId);
    if (player) player.socketId = socketId;
  }

  // ---- membership ----------------------------------------------------

  /** Derived, not stored, so a host handoff (reassignHost) updates it for free. */
  displayName(userId: string): string {
    const player = this.players.get(userId);
    return player ? this.nameFor(player) : "Guest";
  }

  private nameFor(player: PlayerInternal): string {
    return player.isHost ? "Host" : `Guest ${player.guestNumber}`;
  }

  join(userId: string, viaToken: boolean): Result {
    const existing = this.players.get(userId);
    if (existing) {
      existing.connected = true;
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
    const isHost = becomingHost || userId === this.hostId;
    const player: PlayerInternal = {
      id: userId,
      guestNumber: isHost ? undefined : this.nextGuestNumber++,
      connected: true,
      isHost,
      votedMovieIds: new Set(),
    };
    if (becomingHost) this.hostId = userId;
    this.players.set(userId, player);
    this.genrePicks.set(userId, []);
    this.touch();

    if (this.phase === "LOBBY") {
      this.refreshCategoryOptions();
      if (this.genreMode === "PERSONAL") {
        void this.recomputePersonal(userId, ++this.recomputeToken);
      } else if (this.shared.warm === "COLD") {
        void this.recomputeShared(++this.recomputeToken);
      }
    }
    return ok();
  }

  private removePlayer(userId: string, reason: "left" | "timeout") {
    const player = this.players.get(userId);
    if (!player) return;
    const departedName = this.nameFor(player); // compute before deleting — displayName(userId) would 404 after
    if (player.graceTimer) clearTimeout(player.graceTimer);
    this.players.delete(userId);
    this.genrePicks.delete(userId);
    this.personal.delete(userId);
    this.personalCategories.delete(userId);
    this.playerDecks.delete(userId);
    this.playerDeckIds.delete(userId);
    this.progressThrottlers.delete(userId);
    this.io.to(this.code).emit("player:left", { id: userId, reason });
    this.broadcastGenreProgress();
    this.touch();

    if (this.players.size === 0) {
      this.parkEmpty();
      return;
    }
    if (this.hostId === userId) this.reassignHost();

    if (this.phase === "VOTING") {
      const matched = this.evaluateMatches(`Matched after ${departedName} ${reason === "left" ? "left" : "dropped"}`);
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
    this.filters = { ...filters };
    this.touch();
    this.scheduleFilterRecompute();
  }

  setGenreMode(actorId: string, mode: GenreMode): Result {
    if (actorId !== this.hostId) return err("ERR_NOT_HOST");
    if (this.phase !== "LOBBY") return err("ERR_INVALID_PHASE");
    if (mode !== this.genreMode) {
      this.genreMode = mode;
      for (const id of this.genrePicks.keys()) this.genrePicks.set(id, []);
      this.touch();
      this.io.to(this.code).emit("lobby:genreMode", { mode });
      this.broadcastGenreProgress();
      this.scheduleFilterRecompute(true);
    }
    return ok();
  }

  setSolo(actorId: string, solo: boolean): Result {
    if (actorId !== this.hostId) return err("ERR_NOT_HOST");
    if (this.phase !== "LOBBY") return err("ERR_INVALID_PHASE");
    if (solo !== this.solo) {
      this.solo = solo;
      this.touch();
      this.io.to(this.code).emit("lobby:solo", { solo });
    }
    return ok();
  }

  setGenrePicks(userId: string, categories: CategoryId[]) {
    if (this.phase !== "LOBBY") return;
    if (!this.players.has(userId)) return;
    const deduped = [...new Set(categories)].filter((c) => (CATEGORY_IDS as string[]).includes(c));
    this.genrePicks.set(userId, deduped);
    this.touch();
    this.broadcastGenreProgress();
    this.scheduleFilterRecompute();
  }

  private broadcastGenreProgress() {
    const picked = [...this.genrePicks.values()].filter((c) => c.length > 0).length;
    this.io.to(this.code).emit("lobby:genreProgress", { picked, total: this.players.size });
  }

  /** One OR-group per player who has picked something; empty picks contribute no group (see buildWhereClause). */
  private activePickGroups(): CategoryId[][] {
    return [...this.genrePicks.values()].filter((picks) => picks.length > 0);
  }

  scheduleFilterRecompute(immediate = false) {
    clearTimeout(this.filterDebounceTimer);
    if (immediate) {
      void this.runFilterRecompute();
      return;
    }
    this.filterDebounceTimer = setTimeout(() => void this.runFilterRecompute(), LOBBY_FILTER_DEBOUNCE_MS);
  }

  private refreshCategoryOptions() {
    this.categories = getCategoryOptions(this.db, this.filters);
    this.io.to(this.code).emit("lobby:categories", this.categories);
  }

  private async runFilterRecompute() {
    const token = ++this.recomputeToken;
    this.refreshCategoryOptions();

    if (this.genreMode === "SHARED") {
      await this.recomputeShared(token);
    } else {
      await Promise.all([...this.players.keys()].map((userId) => this.recomputePersonal(userId, token)));
    }
  }

  private async recomputeShared(token: number) {
    const categoryGroups = this.activePickGroups();
    this.shared = { ...this.shared, warm: "WARMING" };
    this.io.to(this.code).emit("lobby:warming", { warm: "WARMING", done: 0, total: 0 });

    const result = await prewarmDeck(this.db, this.filters, categoryGroups, (done, total) => {
      if (token !== this.recomputeToken) return;
      this.io.to(this.code).emit("lobby:warming", { warm: "WARMING", done, total });
    });
    if (token !== this.recomputeToken) return;

    this.sharedCategoryGroups = categoryGroups;
    this.shared = {
      warm: "READY",
      warmProgress: { done: result.deckSize, total: result.deckSize },
      deckHash: result.deckHash,
      qualifyingCount: result.qualifyingCount,
      deckSize: result.deckSize,
    };
    this.io.to(this.code).emit("lobby:preview", { deckSize: result.deckSize });
    this.io.to(this.code).emit("lobby:warming", { warm: "READY", done: result.deckSize, total: result.deckSize });
  }

  private async recomputePersonal(userId: string, token: number) {
    if (!this.players.has(userId)) return;
    const categories = this.genrePicks.get(userId) ?? [];
    this.personal.set(userId, { ...(this.personal.get(userId) ?? this.emptySnapshot()), warm: "WARMING" });
    this.emitToPlayer(userId, "lobby:warming", { warm: "WARMING", done: 0, total: 0 });

    // PERSONAL decks aren't merged across players — a single group is just this player's own OR-set, unaffected by SHARED's cross-player intersection.
    const result = await prewarmDeck(this.db, this.filters, [categories], (done, total) => {
      if (token !== this.recomputeToken) return;
      this.emitToPlayer(userId, "lobby:warming", { warm: "WARMING", done, total });
    });
    if (token !== this.recomputeToken || !this.players.has(userId)) return;

    this.personalCategories.set(userId, categories);
    this.personal.set(userId, {
      warm: "READY",
      warmProgress: { done: result.deckSize, total: result.deckSize },
      deckHash: result.deckHash,
      qualifyingCount: result.qualifyingCount,
      deckSize: result.deckSize,
    });
    this.emitToPlayer(userId, "lobby:preview", { deckSize: result.deckSize });
    this.emitToPlayer(userId, "lobby:warming", { warm: "READY", done: result.deckSize, total: result.deckSize });
  }

  private emptySnapshot(): WarmSnapshot {
    return { warm: "COLD", warmProgress: { done: 0, total: 0 }, deckHash: "", qualifyingCount: 0, deckSize: 0 };
  }

  private snapshotFor(userId: string): WarmSnapshot {
    return this.genreMode === "SHARED" ? this.shared : (this.personal.get(userId) ?? this.emptySnapshot());
  }

  private categoriesFor(userId: string): CategoryId[][] {
    return this.genreMode === "SHARED" ? this.sharedCategoryGroups : [this.personalCategories.get(userId) ?? []];
  }

  private blameMessage(qualifyingCount: number): string {
    const n = qualifyingCount;
    if ((this.filters.directors?.length ?? 0) > 0 || (this.filters.cast?.length ?? 0) > 0) {
      return `Only ${n} movies match — the director/cast filter is doing the damage. Try widening it.`;
    }
    if (this.filters.maxRuntime != null) {
      return `Only ${n} movies match — try raising the max runtime.`;
    }
    return `Only ${n} movies match the selected genres. Try adding more.`;
  }

  // ---- session lifecycle -------------------------------------------------

  async startSession(actorId: string): Promise<Result> {
    if (this.phase !== "LOBBY") return err("ERR_INVALID_PHASE");
    if (actorId !== this.hostId) return err("ERR_NOT_HOST");
    if (!this.solo && this.players.size < 2) return err("ERR_BAD_REQUEST", "Need at least 2 players to start.");

    if (this.genreMode === "SHARED") {
      if (this.shared.qualifyingCount < DECK_MIN_TO_START) return err("ERR_DECK_TOO_SMALL", this.blameMessage(this.shared.qualifyingCount));
      if (this.shared.warm !== "READY") return err("ERR_DECK_COLD", "Deck is still warming — try again in a moment.");
    } else {
      for (const [id, player] of this.players) {
        const snap = this.personal.get(id) ?? this.emptySnapshot();
        if (snap.qualifyingCount < DECK_MIN_TO_START) {
          return err("ERR_DECK_TOO_SMALL", `${this.nameFor(player)} only matches ${snap.qualifyingCount} movies — they need to pick more genres.`);
        }
        if (snap.warm !== "READY") return err("ERR_DECK_COLD", "Still warming — try again in a moment.");
      }
    }

    this.phase = "BUILDING";
    this.readyForVoting.clear();
    this.movieById.clear();
    this.playerDecks.clear();
    this.playerDeckIds.clear();

    for (const userId of this.players.keys()) {
      const categories = this.categoriesFor(userId);
      const deckHash = this.snapshotFor(userId).deckHash;
      const cached = getCachedDeck(deckHash);
      const candidateIds = cached?.movieIds ?? getQualifyingMovieIds(this.db, this.filters, categories);
      const seed = `${this.code}:${userId}:${Date.now()}:${Math.random()}`;
      const movies = assembleMovies(this.db, seededShuffle(candidateIds, seed));

      this.playerDecks.set(userId, movies);
      this.playerDeckIds.set(userId, new Set(movies.map((m) => m.id)));
      for (const m of movies) this.movieById.set(m.id, m);

      const assetUrls = movies.flatMap((m) => [m.posterUrl, ...(m.backdropUrl ? [m.backdropUrl] : [])]);
      this.emitToPlayer(userId, "deck:manifest", { deckHash, assetUrls });
    }

    clearTimeout(this.buildingTimer);
    this.buildingTimer = setTimeout(() => this.dealDeck(), BUILDING_ACK_TIMEOUT_MS);
    this.touch();
    return ok();
  }

  clientReady(userId: string, deckHash: string) {
    if (this.phase !== "BUILDING" || deckHash !== this.snapshotFor(userId).deckHash) return;
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
    for (const p of this.players.values()) p.votedMovieIds.clear();
    this.touch();
    for (const [userId, movies] of this.playerDecks) {
      this.emitToPlayer(userId, "deck:dealt", { movies, phase: "VOTING" });
    }
  }

  // ---- voting -------------------------------------------------------

  castVote(userId: string, movieId: string, liked: boolean): Result {
    if (this.phase !== "VOTING") return err("ERR_INVALID_PHASE");
    const player = this.players.get(userId);
    if (!player) return err("ERR_BAD_REQUEST", "Not in room");
    const deckIds = this.playerDeckIds.get(userId);
    if (!deckIds?.has(movieId)) return err("ERR_BAD_REQUEST", "Not in your deck");

    if (player.votedMovieIds.has(movieId)) return ok(); // idempotent: duplicate vote:cast is a no-op

    player.votedMovieIds.add(movieId);
    if (liked) {
      let set = this.yeses.get(movieId);
      if (!set) {
        set = new Set();
        this.yeses.set(movieId, set);
      }
      set.add(userId);
    }
    this.touch();
    this.emitProgress(player);

    const matched = this.evaluateMatches();
    if (!matched) this.checkExhaustion();
    return ok();
  }

  undoVote(userId: string, movieId: string): Result {
    if (this.phase !== "VOTING") return err("ERR_INVALID_PHASE");
    const player = this.players.get(userId);
    if (!player) return err("ERR_BAD_REQUEST", "Not in room");
    if (!player.votedMovieIds.has(movieId)) return ok();

    player.votedMovieIds.delete(movieId);
    this.yeses.get(movieId)?.delete(userId);
    this.touch();
    this.emitProgress(player);
    return ok();
  }

  private emitProgress(player: PlayerInternal) {
    const total = this.playerDecks.get(player.id)?.length ?? 0;
    let throttler = this.progressThrottlers.get(player.id);
    if (!throttler) {
      throttler = new Throttler(250);
      this.progressThrottlers.set(player.id, throttler);
    }
    throttler.run(() => {
      this.io.to(this.code).emit("progress:update", { id: player.id, cursor: player.votedMovieIds.size, total });
    });
  }

  cardFlip(_userId: string, _movieId: string) {
    // Optional telemetry only (PROTOCOL §4) — no state change, no broadcast.
  }

  /** Set.size === connectedPlayerCount — never scans the deck except on a departure recheck. */
  private evaluateMatches(note?: string): boolean {
    if (this.phase !== "VOTING") return false;
    const quorum = this.players.size;
    if (quorum === 0) return false;

    let matchedMovieId: string | undefined;
    for (const [movieId, voters] of this.yeses) {
      if (voters.size === quorum && (matchedMovieId === undefined || movieId < matchedMovieId)) {
        matchedMovieId = movieId;
      }
    }
    if (matchedMovieId === undefined) return false;

    const movie = this.movieById.get(matchedMovieId);
    if (!movie) return false;
    const plexUrl = plexWebUrl(movie.id);
    this.result = { movie, via: "match", plexUrl };
    this.phase = "MATCHED";

    for (const userId of this.players.keys()) {
      const deck = this.playerDecks.get(userId) ?? [];
      const idx = Math.max(deck.findIndex((m) => m.id === matchedMovieId), 0);
      this.emitToPlayer(userId, "match:found", { movie, idx, note, plexUrl });
    }
    // No client ack event is defined on the wire for MATCHED's "auto-advance" —
    // the reveal is driven entirely by match:found, so we advance immediately.
    this.phase = "RESOLVED";
    this.touch();
    return true;
  }

  private checkExhaustion() {
    if (this.phase !== "VOTING") return;
    const allExhausted = [...this.players.values()].every(
      (p) => p.votedMovieIds.size >= (this.playerDecks.get(p.id)?.length ?? 0),
    );
    if (!allExhausted) return;
    this.startRunoffOrResolveEmpty();
  }

  private startRunoffOrResolveEmpty() {
    const scored = [...this.yeses.entries()]
      .map(([movieId, voters]) => ({ movieId, yesCount: voters.size }))
      .filter((e) => e.yesCount > 0)
      .sort((a, b) => b.yesCount - a.yesCount || (a.movieId < b.movieId ? -1 : 1))
      .slice(0, 5);

    this.touch();

    const candidates = scored
      .map((e) => {
        const movie = this.movieById.get(e.movieId);
        return movie ? { movie, yesCount: e.yesCount } : undefined;
      })
      .filter((c): c is RunoffCandidate => !!c);

    if (candidates.length < 2) {
      this.phase = "RESOLVED";
      this.result = undefined;
      this.io.to(this.code).emit("session:resolved:empty", {
        message: "Nobody liked anything — try widening your filters.",
      });
      return;
    }

    this.runoffCandidates = candidates;
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
    // Candidates are already ordered by original yesCount desc / movieId asc, so
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
    this.playerDecks.clear();
    this.playerDeckIds.clear();
    this.movieById.clear();
    this.yeses.clear();
    this.readyForVoting.clear();
    this.runoffCandidates = [];
    this.runoffPicks.clear();
    this.result = undefined;
    for (const p of this.players.values()) p.votedMovieIds.clear();
    this.touch();
    this.scheduleFilterRecompute(true);
    return ok();
  }

  // ---- DTO -------------------------------------------------------

  buildStateDTO(viewerId: string, viewerToken: string): RoomStateDTO {
    const players = [...this.players.values()].map((p) => ({
      id: p.id,
      name: this.nameFor(p),
      connected: p.connected,
      isHost: p.isHost,
      cursor: p.votedMovieIds.size,
    }));

    const progress =
      this.phase === "VOTING"
        ? [...this.players.values()].map((p) => ({
            id: p.id,
            cursor: p.votedMovieIds.size,
            total: this.playerDecks.get(p.id)?.length ?? 0,
          }))
        : undefined;

    const deck =
      this.phase === "VOTING" || this.phase === "MATCHED" || this.phase === "RESOLVED"
        ? this.playerDecks.get(viewerId)
        : undefined;

    const picked = [...this.genrePicks.values()].filter((c) => c.length > 0).length;
    const snap = this.snapshotFor(viewerId);

    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      solo: this.solo,
      you: { id: viewerId, token: viewerToken, categories: this.genrePicks.get(viewerId) ?? [] },
      players,
      filters: this.filters,
      genreMode: this.genreMode,
      genreProgress: { picked, total: this.players.size },
      categories: this.categories,
      deckSize: snap.deckSize,
      warm: snap.warm,
      warmProgress: snap.warmProgress,
      deck,
      progress,
      result: this.result,
      runoffCandidates: this.phase === "RUNOFF" ? this.runoffCandidates : undefined,
      publicUrl: config.publicUrl,
    };
  }

  destroy() {
    clearTimeout(this.buildingTimer);
    clearTimeout(this.filterDebounceTimer);
    for (const p of this.players.values()) clearTimeout(p.graceTimer);
    for (const t of this.progressThrottlers.values()) t.clear();
  }
}
