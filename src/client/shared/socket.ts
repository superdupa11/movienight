import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "../../shared/types";

// socket.io-client's generic order is <ListenEvents, EmitEvents> — the mirror
// of the server's <ClientToServerEvents, ServerToClientEvents>.
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
  path: "/socket.io",
  autoConnect: false,
});
