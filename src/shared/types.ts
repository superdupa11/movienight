// Shared between server and client. Mirrors docs/PROTOCOL.md §2, §4, §5 exactly —
// event names and payload shapes here ARE the wire contract.

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

export type DeckFilters = {
  category: CategoryId | "ALL";
  directors?: number[];
  cast?: number[];
  maxRuntime?: number;
  unwatchedOnly?: boolean;
  yearMin?: number;
  yearMax?: number;
  limit: number;
};

export const DEFAULT_FILTERS: DeckFilters = {
  category: "ALL",
  limit: 40,
};

export const DECK_LIMIT_DEFAULT = 40;
export const DECK_LIMIT_MAX = 100;
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
export type RoomStateDTO = {
  code: string;
  phase: RoomPhase;
  hostId: string;
  you: { id: string; token: string };
  players: Player[];
  filters: DeckFilters;
  categories: CategoryOption[];
  deckSize: number;
  warm: WarmState;
  warmProgress: { done: number; total: number };
  deck?: Movie[];
  progress?: { id: string; cursor: number; total: number }[];
  result?: { movie: Movie; via: "match" | "runoff"; plexUrl: string };
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
  "room:create": (payload: { name: string }, cb: (res: { code: string; token: string } | { error: ErrorCode }) => void) => void;
  "room:join": (payload: { code: string; name: string; token?: string }, cb: (res: RoomStateDTO | { error: ErrorCode; message?: string }) => void) => void;
  "room:leave": (payload: Record<string, never>) => void;
  "lobby:filters": (payload: DeckFilters) => void;
  "people:search": (payload: { q: string; role: "DIRECTOR" | "ACTOR" }) => void;
  "session:start": (payload: Record<string, never>, cb?: (res: { ok: true } | { error: ErrorCode; message?: string }) => void) => void;
  "client:ready": (payload: { deckHash: string }) => void;
  "card:flip": (payload: { idx: number }) => void;
  "vote:cast": (payload: { idx: number; liked: boolean }) => void;
  "vote:undo": (payload: { idx: number }) => void;
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
  "lobby:preview": (payload: { deckSize: number; category: CategoryId | "ALL" }) => void;
  "lobby:warming": (payload: { warm: WarmState; done: number; total: number }) => void;
  "deck:manifest": (payload: { deckHash: string; assetUrls: string[] }) => void;
  "deck:dealt": (payload: { movies: Movie[]; phase: "VOTING" }) => void;
  "progress:update": (payload: { id: string; cursor: number; total: number }) => void;
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
