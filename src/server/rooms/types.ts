import type { DeckFilters, Movie, RoomPhase, WarmState } from "../../shared/types.js";

export type PlayerInternal = {
  id: string;
  name: string;
  socketId?: string; // undefined while in the disconnect grace window
  connected: boolean;
  isHost: boolean;
  graceUntil?: number;
  graceTimer?: NodeJS.Timeout;
  votedIndices: Set<number>;
};

export type RunoffCandidate = { movie: Movie; yesCount: number };

export type RoomInternalState = {
  code: string;
  phase: RoomPhase;
  hostId: string;
  players: Map<string, PlayerInternal>;
  filters: DeckFilters;
  deckHash: string;
  warm: WarmState;
  warmProgress: { done: number; total: number };
  deck: Movie[];
  yeses: Map<number, Set<string>>;
  readyForVoting: Set<string>;
  runoffCandidates: RunoffCandidate[];
  runoffPicks: Map<string, string>; // userId -> movieId
  result?: { movie: Movie; via: "match" | "runoff"; plexUrl: string };
  createdAt: number;
  lastActivityAt: number;
};
