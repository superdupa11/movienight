// Shared between server and client. Mirrors docs/PROTOCOL.md §2, §4, §5 exactly —
// event names and payload shapes here ARE the wire contract.
//
// Deviation from the literal protocol doc (flagged per CLAUDE.md's "raise the
// conflict" rule): genre/category selection is now a guest-facing, multi-select
// feature instead of a host-only single-select. That means deck order (and, in
// PERSONAL mode, deck *content*) is no longer identical for every player, so
// several mechanics that used to be room-wide got promoted to per-player:
//   - matching switched from deckIndex-keyed to movieId-keyed (`vote:cast`,
//     `vote:undo`, `card:flip` now carry `movieId` instead of `idx`)
//   - `deck:manifest` / `deck:dealt` are delivered per-socket, not broadcast
//   - `lobby:preview` / `lobby:warming` broadcast room-wide in SHARED mode but
//     are delivered per-socket in PERSONAL mode (same payload shape either way)
//   - the old `limit`-based deck-size cap is gone; a genre selection deals its
//     full matching set (DECK_LIMIT_MAX remains only as a technical ceiling)

export type CategoryId =
  | "COMEDY"
  | "ROMANCE"
  | "ACTION"
  | "HORROR"
  | "SCIFI_FANTASY"
  | "THRILLER"
  | "DRAMA"
  | "FAMILY"
  | "DOCUMENTARY";

export const CATEGORY_IDS: CategoryId[] = [
  "COMEDY",
  "ROMANCE",
  "ACTION",
  "HORROR",
  "SCIFI_FANTASY",
  "THRILLER",
  "DRAMA",
  "FAMILY",
  "DOCUMENTARY",
];

export const CATEGORY_LABELS: Record<CategoryId, string> = {
  COMEDY: "Comedy",
  ROMANCE: "Romance",
  ACTION: "Action",
  HORROR: "Horror",
  SCIFI_FANTASY: "Sci-Fi & Fantasy",
  THRILLER: "Thriller",
  DRAMA: "Drama",
  FAMILY: "Family",
  DOCUMENTARY: "Documentary",
};

export type RoomPhase = "LOBBY" | "BUILDING" | "VOTING" | "MATCHED" | "RUNOFF" | "RESOLVED";

/**
 * SHARED: every connected player's genre picks combine into one shared
 * qualifying movie set, but *across* players it's an intersection (overlap),
 * not a union — a movie must satisfy every player's own picks. Within one
 * player's own multi-select it's still OR (picking Comedy+Horror means
 * "either" for that person); each player still gets their own shuffled order
 * of that same overlapping set.
 * PERSONAL: each player's deck is filtered by ONLY their own picks —
 * decks can differ in content, not just order. Host-controlled.
 */
export type GenreMode = "SHARED" | "PERSONAL";

// Host-controlled, room-wide, non-genre filters. Genre picks live separately
// (per-player, see GenrePicks below) since they're guest-editable and their
// aggregation depends on GenreMode.
export type DeckFilters = {
  directors?: number[];
  cast?: number[];
  maxRuntime?: number;
  unwatchedOnly?: boolean;
  yearMin?: number;
  yearMax?: number;
};

export const DEFAULT_FILTERS: DeckFilters = {};

// Technical safety ceiling only — not a default trim. A genre selection deals
// its full matching set; this just guards against a pathological "every
// category" selection producing an unbounded deck.
export const DECK_LIMIT_MAX = 300;
export const DECK_MIN_TO_START = 8;
export const CATEGORY_GREY_OUT_BELOW = 5;
export const PERSON_MIN_MOVIES_FOR_TYPEAHEAD = 2;
export const DISCONNECT_GRACE_MS = 90_000;
export const BUILDING_ACK_TIMEOUT_MS = 3_000;
export const LOBBY_FILTER_DEBOUNCE_MS = 400;
export const ROOM_ABANDONED_SWEEP_MS = 4 * 60 * 60 * 1000;
export const SESSION_TOKEN_EXPIRY = "6h";

export type Movie = {
  id: string;
  title: string;
  year: number;
  runtime: number;
  genres: string[];
  categories: CategoryId[];
  contentRating?: string;

  posterUrl: string;
  backdropUrl?: string;

  tagline?: string;
  summary: string;
  directors: string[];
  cast: string[];
  audienceRating?: number;
  criticRating?: number;
  unwatched: boolean;
};

export type Player = {
  id: string;
  name: string;
  connected: boolean;
  isHost: boolean;
  cursor: number;
};

export type CategoryOption = { id: CategoryId; label: string; count: number };

export type WarmState = "COLD" | "WARMING" | "READY";

// The DTO sent to a joining/rejoining client on `room:state` — never the raw
// server-side RoomState (that has Maps/Sets, which don't serialize).
//
// deckSize/warm/warmProgress/deck are always THIS VIEWER's own values (their
// personal preview/deck), computed fresh at DTO-build time — never read from
// a stale room-wide field, which was the source of a real bug where a client
// joining/rejoining after the last recompute got stuck with deckSize: 0.
export type RoomStateDTO = {
  code: string;
  phase: RoomPhase;
  hostId: string;
  solo: boolean;
  you: { id: string; token: string; categories: CategoryId[] };
  players: Player[];
  filters: DeckFilters;
  genreMode: GenreMode;
  genreProgress: { picked: number; total: number };
  categories: CategoryOption[];
  deckSize: number;
  warm: WarmState;
  warmProgress: { done: number; total: number };
  deck?: Movie[];
  progress?: { id: string; cursor: number; total: number }[];
  result?: { movie: Movie; via: "match" | "runoff"; idx?: number; plexUrl: string };
  runoffCandidates?: { movie: Movie; yesCount: number }[];
  publicUrl: string;
};

export type PersonResult = { id: number; name: string; movieCount: number };

export const ERROR_CODES = [
  "ERR_ROOM_LOCKED",
  "ERR_NOT_HOST",
  "ERR_ROOM_NOT_FOUND",
  "ERR_DECK_TOO_SMALL",
  "ERR_DECK_COLD",
  "ERR_INVALID_PHASE",
  "ERR_BAD_REQUEST",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

// ---- Client -> Server events (PROTOCOL §4) --------------------------------

export type ClientToServerEvents = {
  "room:create": (payload: { solo?: boolean }, cb: (res: { code: string; token: string } | { error: ErrorCode }) => void) => void;
  "room:join": (payload: { code: string; token?: string }, cb: (res: RoomStateDTO | { error: ErrorCode; message?: string }) => void) => void;
  "room:leave": (payload: Record<string, never>) => void;
  "lobby:filters": (payload: DeckFilters) => void;
  // Additions beyond the literal §4 table — genre picking moved from a
  // host-only single-select inside `lobby:filters` to a guest-editable
  // multi-select with its own aggregation mode.
  "lobby:genres": (payload: { categories: CategoryId[] }) => void;
  "lobby:genreMode": (payload: { mode: GenreMode }) => void;
  "people:search": (payload: { q: string; role: "DIRECTOR" | "ACTOR" }) => void;
  "session:start": (payload: Record<string, never>, cb?: (res: { ok: true } | { error: ErrorCode; message?: string }) => void) => void;
  "client:ready": (payload: { deckHash: string }) => void;
  // idx -> movieId: see file header. A player's deck order/content is no
  // longer guaranteed identical to anyone else's.
  "card:flip": (payload: { movieId: string }) => void;
  "vote:cast": (payload: { movieId: string; liked: boolean }) => void;
  "vote:undo": (payload: { movieId: string }) => void;
  "runoff:pick": (payload: { movieId: string }) => void;
  "runoff:force": (payload: Record<string, never>) => void;
  "session:reset": (payload: Record<string, never>) => void;
};

// ---- Server -> Client events (PROTOCOL §5) --------------------------------

export type ServerToClientEvents = {
  "room:state": (dto: RoomStateDTO) => void;
  "player:joined": (payload: { id: string; name: string }) => void;
  "player:left": (payload: { id: string; reason: "left" | "timeout" | "kicked" }) => void;
  "player:presence": (payload: { id: string; connected: boolean }) => void;
  // `role` is an addition beyond the literal §5 table — the table's payload
  // omits it, but a client with both director/cast typeahead boxes open has
  // no other way to route a response to the right box. Flagged as a spec gap.
  "people:results": (payload: { q: string; role: "DIRECTOR" | "ACTOR"; people: PersonResult[] }) => void;
  "lobby:categories": (payload: CategoryOption[]) => void;
  // Live-update broadcast for a mid-lobby mode toggle — room:state covers the
  // join/rejoin snapshot, this covers everyone already connected.
  "lobby:genreMode": (payload: { mode: GenreMode }) => void;
  // Addition: lets clients show "N people have picked" without attributing
  // picks to individuals (deliberately no per-user breakdown on the wire).
  "lobby:genreProgress": (payload: { picked: number; total: number }) => void;
  // Same payload shape as before `payload: { deckSize: number }` (category
  // dropped — multi-select means there's no single "current category" to
  // report). Delivery target depends on GenreMode: room-wide broadcast in
  // SHARED, per-socket in PERSONAL — invisible to the client either way.
  "lobby:preview": (payload: { deckSize: number }) => void;
  "lobby:warming": (payload: { warm: WarmState; done: number; total: number }) => void;
  "deck:manifest": (payload: { deckHash: string; assetUrls: string[] }) => void;
  "deck:dealt": (payload: { movies: Movie[]; phase: "VOTING" }) => void;
  "progress:update": (payload: { id: string; cursor: number; total: number }) => void;
  // `idx` is now this recipient's own position in their own deck (match:found
  // is delivered per-socket) — meaningful again despite decks differing.
  // `plexUrl` is an addition beyond the literal §5 table — PROTOCOL §6 asks
  // for "a deep link to the title in Plex" on the reveal screen, which needs
  // *some* Plex URL reaching the client. CLAUDE.md invariant #1 ("no Plex URL
  // is ever sent to a client") is written about poster/backdrop proxying; we
  // keep that fully intact and confine this narrow, tokenless exception to
  // the reveal moment only, never the swipe deck. Flagged as a spec tension.
  "match:found": (payload: { movie: Movie; idx: number; note?: string; plexUrl: string }) => void;
  "runoff:start": (payload: { candidates: { movie: Movie; yesCount: number }[] }) => void;
  "runoff:tally": (payload: { picksIn: number; total: number }) => void;
  "runoff:result": (payload: { movie: Movie; votes: number; plexUrl: string }) => void;
  "session:resolved:empty": (payload: { message: string }) => void;
  error: (payload: { code: ErrorCode; message: string }) => void;
};
