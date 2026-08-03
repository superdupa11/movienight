import type { CategoryOption, Player, RoomStateDTO } from "../../shared/types.js";
import { config } from "../config.js";
import type { PlayerInternal, RoomInternalState } from "./types.js";

export function toPlayerDTO(p: PlayerInternal): Player {
  return { id: p.id, name: p.name, connected: p.connected, isHost: p.isHost, cursor: p.votedIndices.size };
}

export function buildRoomStateDTO(
  room: RoomInternalState,
  viewerId: string,
  viewerToken: string,
  categories: CategoryOption[],
): RoomStateDTO {
  const players = [...room.players.values()].map(toPlayerDTO);
  const progress =
    room.phase === "VOTING"
      ? [...room.players.values()].map((p) => ({ id: p.id, cursor: p.votedIndices.size, total: room.deck.length }))
      : undefined;

  return {
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    you: { id: viewerId, token: viewerToken },
    players,
    filters: room.filters,
    categories,
    deckSize: room.deck.length,
    warm: room.warm,
    warmProgress: room.warmProgress,
    deck: room.phase === "VOTING" || room.phase === "MATCHED" || room.phase === "RESOLVED" ? room.deck : undefined,
    progress,
    result: room.result,
    runoffCandidates: room.phase === "RUNOFF" ? room.runoffCandidates : undefined,
    publicUrl: config.publicUrl,
  };
}
