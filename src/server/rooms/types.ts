import type { Movie } from "../../shared/types.js";

export type PlayerInternal = {
  id: string;
  // Display name is derived (Room.displayName), not stored — "Host" tracks
  // isHost so a handoff via reassignHost() updates it for free; guestNumber
  // is assigned once at join and never reused, even if earlier guests leave.
  guestNumber?: number;
  socketId?: string; // undefined while in the disconnect grace window
  connected: boolean;
  isHost: boolean;
  graceUntil?: number;
  graceTimer?: NodeJS.Timeout;
  votedMovieIds: Set<string>;
};

export type RunoffCandidate = { movie: Movie; yesCount: number };
