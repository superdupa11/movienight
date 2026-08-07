import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import { CATEGORY_IDS, type ErrorCode } from "../../shared/types.js";
import { searchPeople } from "../db/people.js";
import { signSessionToken, verifySessionToken } from "./auth.js";
import type { AppServer, AppSocket } from "./ioTypes.js";
import { RoomManager } from "./roomManager.js";
import type { Room } from "./Room.js";

const deckFiltersSchema = z.object({
  directors: z.array(z.number()).optional(),
  cast: z.array(z.number()).optional(),
  maxRuntime: z.number().positive().optional(),
  unwatchedOnly: z.boolean().optional(),
  yearMin: z.number().optional(),
  yearMax: z.number().optional(),
});

const CATEGORY_SET = new Set<string>(CATEGORY_IDS);
const genresSchema = z.object({
  categories: z.array(z.string().refine((c) => CATEGORY_SET.has(c))).max(CATEGORY_IDS.length),
});

export function registerSocketHandlers(io: AppServer, db: Database.Database): RoomManager {
  const roomManager = new RoomManager(io, db);

  function roomFor(socket: AppSocket): Room | undefined {
    const code = socket.data.roomCode;
    return code ? roomManager.get(code) : undefined;
  }

  function emitError(socket: AppSocket, code: ErrorCode, message?: string) {
    socket.emit("error", { code, message: message ?? code });
  }

  io.on("connection", (socket: AppSocket) => {
    socket.on("room:create", (payload, cb) => {
      const userId = randomUUID();
      const room = roomManager.create(userId, !!payload?.solo);
      room.join(userId, false);
      const token = signSessionToken({ roomCode: room.code, userId });
      cb({ code: room.code, token });
    });

    socket.on("room:join", (payload, cb) => {
      const room = roomManager.get((payload.code || "").toUpperCase());
      if (!room) return cb({ error: "ERR_ROOM_NOT_FOUND" });

      const tokenPayload = payload.token ? verifySessionToken(payload.token) : undefined;
      const viaToken = !!tokenPayload && tokenPayload.roomCode === room.code;
      const userId = viaToken ? tokenPayload!.userId : randomUUID();

      const result = room.join(userId, viaToken);
      if (!result.ok) return cb({ error: result.error, message: result.message });

      socket.data.userId = userId;
      socket.data.roomCode = room.code;
      void socket.join(room.code);
      room.setSocketId(userId, socket.id);

      const token = viaToken ? (payload.token as string) : signSessionToken({ roomCode: room.code, userId });
      cb(room.buildStateDTO(userId, token));

      socket.to(room.code).emit("player:joined", { id: userId, name: room.displayName(userId) });
    });

    socket.on("room:leave", () => {
      const { userId, roomCode } = socket.data;
      if (userId && roomCode) roomManager.get(roomCode)?.leave(userId);
      if (roomCode) void socket.leave(roomCode);
      socket.data.userId = undefined;
      socket.data.roomCode = undefined;
    });

    socket.on("lobby:filters", (payload) => {
      const room = roomFor(socket);
      if (!room) return emitError(socket, "ERR_ROOM_NOT_FOUND");
      if (socket.data.userId !== room.hostId) return emitError(socket, "ERR_NOT_HOST");
      const parsed = deckFiltersSchema.safeParse(payload);
      if (!parsed.success) return emitError(socket, "ERR_BAD_REQUEST", "Malformed filters");
      room.setFilters(parsed.data);
    });

    // Guest-editable, unlike lobby:filters — any connected player sets their
    // own genre picks. How picks combine into what's actually dealt depends
    // on the host-controlled genreMode (see Room.setGenrePicks/genreMode).
    socket.on("lobby:genres", (payload) => {
      const room = roomFor(socket);
      if (!room || !socket.data.userId) return emitError(socket, "ERR_ROOM_NOT_FOUND");
      const parsed = genresSchema.safeParse(payload);
      if (!parsed.success) return emitError(socket, "ERR_BAD_REQUEST", "Malformed genre picks");
      room.setGenrePicks(socket.data.userId, parsed.data.categories as (typeof CATEGORY_IDS)[number][]);
    });

    socket.on("lobby:genreMode", ({ mode }) => {
      const room = roomFor(socket);
      if (!room || !socket.data.userId) return emitError(socket, "ERR_ROOM_NOT_FOUND");
      if (mode !== "SHARED" && mode !== "PERSONAL") return emitError(socket, "ERR_BAD_REQUEST");
      const result = room.setGenreMode(socket.data.userId, mode);
      if (!result.ok) emitError(socket, result.error, result.message);
    });

    socket.on("lobby:solo", ({ solo }) => {
      const room = roomFor(socket);
      if (!room || !socket.data.userId) return emitError(socket, "ERR_ROOM_NOT_FOUND");
      if (typeof solo !== "boolean") return emitError(socket, "ERR_BAD_REQUEST");
      const result = room.setSolo(socket.data.userId, solo);
      if (!result.ok) emitError(socket, result.error, result.message);
    });

    socket.on("people:search", ({ q, role }) => {
      const room = roomFor(socket);
      if (!room) return emitError(socket, "ERR_ROOM_NOT_FOUND");
      if (socket.data.userId !== room.hostId) return emitError(socket, "ERR_NOT_HOST");
      if (role !== "DIRECTOR" && role !== "ACTOR") return emitError(socket, "ERR_BAD_REQUEST");
      if (!q || q.length < 2) return socket.emit("people:results", { q, role, people: [] });
      socket.emit("people:results", { q, role, people: searchPeople(db, q, role) });
    });

    socket.on("session:start", async (_payload, cb) => {
      const room = roomFor(socket);
      if (!room) return cb?.({ error: "ERR_ROOM_NOT_FOUND" });
      const userId = socket.data.userId!;
      const result = await room.startSession(userId);
      if (!result.ok) {
        emitError(socket, result.error, result.message);
        return cb?.({ error: result.error, message: result.message });
      }
      cb?.({ ok: true });
    });

    socket.on("client:ready", ({ deckHash }) => {
      const room = roomFor(socket);
      if (room && socket.data.userId) room.clientReady(socket.data.userId, deckHash);
    });

    socket.on("card:flip", ({ movieId }) => {
      const room = roomFor(socket);
      if (room && socket.data.userId) room.cardFlip(socket.data.userId, movieId);
    });

    socket.on("vote:cast", ({ movieId, liked }) => {
      const room = roomFor(socket);
      if (!room || !socket.data.userId) return;
      const result = room.castVote(socket.data.userId, movieId, !!liked);
      if (!result.ok) emitError(socket, result.error, result.message);
    });

    socket.on("vote:undo", ({ movieId }) => {
      const room = roomFor(socket);
      if (!room || !socket.data.userId) return;
      const result = room.undoVote(socket.data.userId, movieId);
      if (!result.ok) emitError(socket, result.error, result.message);
    });

    socket.on("runoff:pick", ({ movieId }) => {
      const room = roomFor(socket);
      if (!room || !socket.data.userId) return;
      const result = room.runoffPick(socket.data.userId, movieId);
      if (!result.ok) emitError(socket, result.error, result.message);
    });

    socket.on("runoff:force", () => {
      const room = roomFor(socket);
      if (!room || !socket.data.userId) return;
      const result = room.forceRunoff(socket.data.userId);
      if (!result.ok) emitError(socket, result.error, result.message);
    });

    socket.on("session:reset", () => {
      const room = roomFor(socket);
      if (!room || !socket.data.userId) return;
      const result = room.resetSession(socket.data.userId);
      if (!result.ok) emitError(socket, result.error, result.message);
    });

    socket.on("plex:openOnTv", () => {
      const room = roomFor(socket);
      if (!room || !socket.data.userId) return;
      const result = room.openOnTv(socket.data.userId);
      if (!result.ok) emitError(socket, result.error, result.message);
    });

    socket.on("plex:selectDevice", ({ deviceId }) => {
      const room = roomFor(socket);
      if (!room || !socket.data.userId) return;
      const result = room.selectDevice(socket.data.userId, deviceId);
      if (!result.ok) emitError(socket, result.error, result.message);
    });

    socket.on("plex:cancelSleepTimer", () => {
      const room = roomFor(socket);
      if (!room || !socket.data.userId) return;
      const result = room.cancelSleepTimer(socket.data.userId);
      if (!result.ok) emitError(socket, result.error, result.message);
    });

    socket.on("disconnect", () => {
      const { userId, roomCode } = socket.data;
      if (userId && roomCode) roomManager.get(roomCode)?.disconnectPlayer(userId);
    });
  });

  return roomManager;
}
