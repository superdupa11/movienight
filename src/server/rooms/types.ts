import type { Movie } from "../../shared/types.js";

export type PlayerInternal = {
  id: string;
  name: string;
  socketId?: string; // undefined while in the disconnect grace window
  connected: boolean;
  isHost: boolean;
  graceUntil?: number;
  graceTimer?: NodeJS.Timeout;
  votedMovieIds: Set<string>;
};

export type RunoffCandidate = { movie: Movie; yesCount: number };
