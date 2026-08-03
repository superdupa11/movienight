import type Database from "better-sqlite3";
import { ROOM_ABANDONED_SWEEP_MS } from "../../shared/types.js";
import { generateRoomCode } from "./code.js";
import type { AppServer } from "./ioTypes.js";
import { Room } from "./Room.js";

const SWEEP_INTERVAL_MS = 30 * 60 * 1000;

export class RoomManager {
  private rooms = new Map<string, Room>();
  private sweepTimer: NodeJS.Timeout;

  constructor(
    private readonly io: AppServer,
    private readonly db: Database.Database,
  ) {
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    this.sweepTimer.unref?.();
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  create(hostId: string, solo = false): Room {
    let code = generateRoomCode();
    while (this.rooms.has(code)) code = generateRoomCode();
    const room = new Room(code, hostId, this.io, this.db, solo);
    this.rooms.set(code, room);
    return room;
  }

  private sweep() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (now - room.lastActivityAt > ROOM_ABANDONED_SWEEP_MS) {
        room.destroy();
        this.rooms.delete(code);
      }
    }
  }
}
