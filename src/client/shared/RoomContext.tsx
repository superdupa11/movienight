import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import type { ReactNode } from "react";
import type {
  CategoryId,
  CategoryOption,
  DeckFilters,
  ErrorCode,
  GenreMode,
  Movie,
  Player,
  PersonResult,
  RoomPhase,
  WarmState,
} from "../../shared/types";
import { DEFAULT_FILTERS } from "../../shared/types";
import { socket } from "./socket";
import { clearSession, loadSession, saveSession } from "./sessionStorage";

type Status = "idle" | "connecting" | "in-room" | "kicked-out";

type ResultInfo = { movie: Movie; via: "match" | "runoff"; note?: string; votes?: number; idx?: number; plexUrl: string };

type State = {
  status: Status;
  code?: string;
  you?: { id: string; token: string };
  myCategories: CategoryId[];
  hostId?: string;
  solo: boolean;
  phase?: RoomPhase;
  players: Player[];
  filters: DeckFilters;
  genreMode: GenreMode;
  genreProgress: { picked: number; total: number };
  categories: CategoryOption[];
  deckSize: number;
  warm: WarmState;
  warmProgress: { done: number; total: number };
  deck?: Movie[];
  buildingDeckHash?: string;
  buildingAssetUrls?: string[];
  progress: Record<string, { cursor: number; total: number }>;
  result?: ResultInfo;
  runoffCandidates?: { movie: Movie; yesCount: number }[];
  runoffTally?: { picksIn: number; total: number };
  emptyMessage?: string;
  peopleResults: Record<"DIRECTOR" | "ACTOR", { q: string; people: PersonResult[] }>;
  publicUrl?: string;
  lastError?: { code: ErrorCode; message: string; at: number };
};

const initialState: State = {
  status: "idle",
  myCategories: [],
  solo: false,
  players: [],
  filters: { ...DEFAULT_FILTERS },
  genreMode: "SHARED",
  genreProgress: { picked: 0, total: 0 },
  categories: [],
  deckSize: 0,
  warm: "COLD",
  warmProgress: { done: 0, total: 0 },
  progress: {},
  peopleResults: { DIRECTOR: { q: "", people: [] }, ACTOR: { q: "", people: [] } },
};

type Action =
  | { type: "CONNECTING" }
  | { type: "JOINED"; dto: import("../../shared/types").RoomStateDTO }
  | { type: "PLAYER_JOINED"; id: string; name: string }
  | { type: "PLAYER_LEFT"; id: string }
  | { type: "PLAYER_PRESENCE"; id: string; connected: boolean }
  | { type: "PEOPLE_RESULTS"; q: string; role: "DIRECTOR" | "ACTOR"; people: PersonResult[] }
  | { type: "CATEGORIES"; categories: CategoryOption[] }
  | { type: "GENRE_MODE"; mode: GenreMode }
  | { type: "SOLO_MODE"; solo: boolean }
  | { type: "GENRE_PROGRESS"; picked: number; total: number }
  | { type: "PREVIEW"; deckSize: number }
  | { type: "WARMING"; warm: WarmState; done: number; total: number }
  | { type: "DECK_MANIFEST"; deckHash: string; assetUrls: string[] }
  | { type: "DECK_DEALT"; movies: Movie[] }
  | { type: "PROGRESS"; id: string; cursor: number; total: number }
  | { type: "MATCH_FOUND"; movie: Movie; idx: number; note?: string; plexUrl: string }
  | { type: "RUNOFF_START"; candidates: { movie: Movie; yesCount: number }[] }
  | { type: "RUNOFF_TALLY"; picksIn: number; total: number }
  | { type: "RUNOFF_RESULT"; movie: Movie; votes: number; plexUrl: string }
  | { type: "RESOLVED_EMPTY"; message: string }
  | { type: "ERROR"; code: ErrorCode; message: string }
  | { type: "RESET_LOCAL" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "CONNECTING":
      return { ...state, status: "connecting" };
    case "JOINED":
      return {
        ...state,
        status: "in-room",
        code: action.dto.code,
        you: { id: action.dto.you.id, token: action.dto.you.token },
        myCategories: action.dto.you.categories,
        hostId: action.dto.hostId,
        solo: action.dto.solo,
        phase: action.dto.phase,
        players: action.dto.players,
        filters: action.dto.filters,
        genreMode: action.dto.genreMode,
        genreProgress: action.dto.genreProgress,
        categories: action.dto.categories,
        deckSize: action.dto.deckSize,
        warm: action.dto.warm,
        warmProgress: action.dto.warmProgress,
        deck: action.dto.deck,
        progress: Object.fromEntries((action.dto.progress ?? []).map((p) => [p.id, { cursor: p.cursor, total: p.total }])),
        result: action.dto.result,
        runoffCandidates: action.dto.runoffCandidates,
        publicUrl: action.dto.publicUrl,
      };
    case "PLAYER_JOINED":
      if (state.players.some((p) => p.id === action.id)) return state;
      return { ...state, players: [...state.players, { id: action.id, name: action.name, connected: true, isHost: false, cursor: 0 }] };
    case "PLAYER_LEFT":
      return { ...state, players: state.players.filter((p) => p.id !== action.id) };
    case "PLAYER_PRESENCE":
      return { ...state, players: state.players.map((p) => (p.id === action.id ? { ...p, connected: action.connected } : p)) };
    case "PEOPLE_RESULTS":
      return { ...state, peopleResults: { ...state.peopleResults, [action.role]: { q: action.q, people: action.people } } };
    case "CATEGORIES":
      return { ...state, categories: action.categories, phase: "LOBBY" };
    case "GENRE_MODE":
      // Server resets everyone's picks on a mode change — mirror that locally
      // so a guest's chip selection doesn't go stale (it was cleared server-side).
      return { ...state, genreMode: action.mode, myCategories: [] };
    case "SOLO_MODE":
      return { ...state, solo: action.solo };
    case "GENRE_PROGRESS":
      return { ...state, genreProgress: { picked: action.picked, total: action.total } };
    case "PREVIEW":
      return { ...state, deckSize: action.deckSize };
    case "WARMING":
      return { ...state, warm: action.warm, warmProgress: { done: action.done, total: action.total } };
    case "DECK_MANIFEST":
      return { ...state, phase: "BUILDING", buildingDeckHash: action.deckHash, buildingAssetUrls: action.assetUrls };
    case "DECK_DEALT":
      return {
        ...state,
        phase: "VOTING",
        deck: action.movies,
        progress: Object.fromEntries(state.players.map((p) => [p.id, { cursor: 0, total: action.movies.length }])),
        result: undefined,
      };
    case "PROGRESS":
      return { ...state, progress: { ...state.progress, [action.id]: { cursor: action.cursor, total: action.total } } };
    case "MATCH_FOUND":
      return { ...state, phase: "MATCHED", result: { movie: action.movie, via: "match", note: action.note, idx: action.idx, plexUrl: action.plexUrl } };
    case "RUNOFF_START":
      return { ...state, phase: "RUNOFF", runoffCandidates: action.candidates, runoffTally: { picksIn: 0, total: state.players.length } };
    case "RUNOFF_TALLY":
      return { ...state, runoffTally: { picksIn: action.picksIn, total: action.total } };
    case "RUNOFF_RESULT":
      return { ...state, phase: "RESOLVED", result: { movie: action.movie, via: "runoff", votes: action.votes, plexUrl: action.plexUrl } };
    case "RESOLVED_EMPTY":
      return { ...state, phase: "RESOLVED", result: undefined, emptyMessage: action.message };
    case "ERROR":
      return { ...state, lastError: { code: action.code, message: action.message, at: Date.now() } };
    case "RESET_LOCAL":
      return { ...initialState };
    default:
      return state;
  }
}

type RoomApi = {
  state: State;
  createRoom: (solo?: boolean) => Promise<{ ok: true } | { ok: false; message: string }>;
  joinRoom: (code: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  rejoin: () => void;
  leaveRoom: () => void;
  setFilters: (filters: DeckFilters) => void;
  setGenres: (categories: CategoryId[]) => void;
  setGenreMode: (mode: GenreMode) => void;
  setSolo: (solo: boolean) => void;
  searchPeople: (q: string, role: "DIRECTOR" | "ACTOR") => void;
  startSession: () => Promise<{ ok: true } | { ok: false; message: string }>;
  clientReady: (deckHash: string) => void;
  castVote: (movieId: string, liked: boolean) => void;
  undoVote: (movieId: string) => void;
  cardFlip: (movieId: string) => void;
  runoffPick: (movieId: string) => void;
  forceRunoff: () => void;
  resetSession: () => void;
};

const RoomCtx = createContext<RoomApi | undefined>(undefined);

export function RoomProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    socket.connect();

    socket.on("player:joined", (p) => dispatch({ type: "PLAYER_JOINED", ...p }));
    socket.on("player:left", (p) => dispatch({ type: "PLAYER_LEFT", id: p.id }));
    socket.on("player:presence", (p) => dispatch({ type: "PLAYER_PRESENCE", ...p }));
    socket.on("people:results", (p) => dispatch({ type: "PEOPLE_RESULTS", ...p }));
    socket.on("lobby:categories", (categories) => dispatch({ type: "CATEGORIES", categories }));
    socket.on("lobby:genreMode", (p) => dispatch({ type: "GENRE_MODE", mode: p.mode }));
    socket.on("lobby:solo", (p) => dispatch({ type: "SOLO_MODE", solo: p.solo }));
    socket.on("lobby:genreProgress", (p) => dispatch({ type: "GENRE_PROGRESS", ...p }));
    socket.on("lobby:preview", (p) => dispatch({ type: "PREVIEW", deckSize: p.deckSize }));
    socket.on("lobby:warming", (p) => dispatch({ type: "WARMING", ...p }));
    socket.on("deck:manifest", (p) => dispatch({ type: "DECK_MANIFEST", deckHash: p.deckHash, assetUrls: p.assetUrls }));
    socket.on("deck:dealt", (p) => dispatch({ type: "DECK_DEALT", movies: p.movies }));
    socket.on("progress:update", (p) => dispatch({ type: "PROGRESS", ...p }));
    socket.on("match:found", (p) => dispatch({ type: "MATCH_FOUND", movie: p.movie, idx: p.idx, note: p.note, plexUrl: p.plexUrl }));
    socket.on("runoff:start", (p) => dispatch({ type: "RUNOFF_START", candidates: p.candidates }));
    socket.on("runoff:tally", (p) => dispatch({ type: "RUNOFF_TALLY", ...p }));
    socket.on("runoff:result", (p) => dispatch({ type: "RUNOFF_RESULT", ...p }));
    socket.on("session:resolved:empty", (p) => dispatch({ type: "RESOLVED_EMPTY", message: p.message }));
    socket.on("error", (p) => dispatch({ type: "ERROR", ...p }));

    const stored = loadSession();
    if (stored) {
      dispatch({ type: "CONNECTING" });
      socket.emit("room:join", { code: stored.code, token: stored.token }, (res) => {
        if ("error" in res) {
          clearSession();
          dispatch({ type: "RESET_LOCAL" });
        } else {
          saveSession({ code: res.code, token: res.you.token });
          dispatch({ type: "JOINED", dto: res });
        }
      });
    }

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createRoom = useCallback((solo?: boolean) => {
    dispatch({ type: "CONNECTING" });
    return new Promise<{ ok: true } | { ok: false; message: string }>((resolve) => {
      socket.emit("room:create", { solo }, (res) => {
        if ("error" in res) return resolve({ ok: false, message: res.error });
        socket.emit("room:join", { code: res.code, token: res.token }, (joinRes) => {
          if ("error" in joinRes) return resolve({ ok: false, message: joinRes.message ?? joinRes.error });
          saveSession({ code: joinRes.code, token: joinRes.you.token });
          dispatch({ type: "JOINED", dto: joinRes });
          resolve({ ok: true });
        });
      });
    });
  }, []);

  const joinRoom = useCallback((code: string) => {
    dispatch({ type: "CONNECTING" });
    return new Promise<{ ok: true } | { ok: false; message: string }>((resolve) => {
      socket.emit("room:join", { code: code.toUpperCase() }, (res) => {
        if ("error" in res) return resolve({ ok: false, message: res.message ?? res.error });
        saveSession({ code: res.code, token: res.you.token });
        dispatch({ type: "JOINED", dto: res });
        resolve({ ok: true });
      });
    });
  }, []);

  const rejoin = useCallback(() => {
    const stored = loadSession();
    if (!stored) return;
    socket.emit("room:join", { code: stored.code, token: stored.token }, (res) => {
      if (!("error" in res)) dispatch({ type: "JOINED", dto: res });
    });
  }, []);

  const leaveRoom = useCallback(() => {
    socket.emit("room:leave", {});
    clearSession();
    dispatch({ type: "RESET_LOCAL" });
  }, []);

  const setFilters = useCallback((filters: DeckFilters) => socket.emit("lobby:filters", filters), []);
  const setGenres = useCallback((categories: CategoryId[]) => socket.emit("lobby:genres", { categories }), []);
  const setGenreMode = useCallback((mode: GenreMode) => socket.emit("lobby:genreMode", { mode }), []);
  const setSolo = useCallback((solo: boolean) => socket.emit("lobby:solo", { solo }), []);
  const searchPeopleFn = useCallback((q: string, role: "DIRECTOR" | "ACTOR") => socket.emit("people:search", { q, role }), []);

  const startSession = useCallback(() => {
    return new Promise<{ ok: true } | { ok: false; message: string }>((resolve) => {
      socket.emit("session:start", {}, (res) => {
        if (!res || "ok" in res) return resolve({ ok: true });
        resolve({ ok: false, message: res.message ?? res.error });
      });
    });
  }, []);

  const clientReady = useCallback((deckHash: string) => socket.emit("client:ready", { deckHash }), []);
  const castVote = useCallback((movieId: string, liked: boolean) => socket.emit("vote:cast", { movieId, liked }), []);
  const undoVote = useCallback((movieId: string) => socket.emit("vote:undo", { movieId }), []);
  const cardFlip = useCallback((movieId: string) => socket.emit("card:flip", { movieId }), []);
  const runoffPick = useCallback((movieId: string) => socket.emit("runoff:pick", { movieId }), []);
  const forceRunoff = useCallback(() => socket.emit("runoff:force", {}), []);
  const resetSession = useCallback(() => socket.emit("session:reset", {}), []);

  const api = useMemo<RoomApi>(
    () => ({
      state,
      createRoom,
      joinRoom,
      rejoin,
      leaveRoom,
      setFilters,
      setGenres,
      setGenreMode,
      setSolo,
      searchPeople: searchPeopleFn,
      startSession,
      clientReady,
      castVote,
      undoVote,
      cardFlip,
      runoffPick,
      forceRunoff,
      resetSession,
    }),
    [state, createRoom, joinRoom, rejoin, leaveRoom, setFilters, setGenres, setGenreMode, setSolo, searchPeopleFn, startSession, clientReady, castVote, undoVote, cardFlip, runoffPick, forceRunoff, resetSession],
  );

  return <RoomCtx.Provider value={api}>{children}</RoomCtx.Provider>;
}

export function useRoom(): RoomApi {
  const ctx = useContext(RoomCtx);
  if (!ctx) throw new Error("useRoom must be used within RoomProvider");
  return ctx;
}
