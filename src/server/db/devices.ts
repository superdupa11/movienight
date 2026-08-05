import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export type TvDevice = { id: string; name: string; plexMachineIdentifier: string; plexProduct: string | null };

export function listDevices(db: Database.Database): TvDevice[] {
  const rows = db
    .prepare("SELECT id, name, plex_machine_identifier AS plexMachineIdentifier, plex_product AS plexProduct FROM tv_device ORDER BY created_at")
    .all() as TvDevice[];
  return rows;
}

export function addDevice(db: Database.Database, name: string, plexMachineIdentifier: string, plexProduct: string | null): TvDevice {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO tv_device (id, name, plex_machine_identifier, plex_product, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (plex_machine_identifier) DO UPDATE SET name = excluded.name, plex_product = excluded.plex_product`,
  ).run(id, name, plexMachineIdentifier, plexProduct, Date.now());
  const row = db
    .prepare("SELECT id, name, plex_machine_identifier AS plexMachineIdentifier, plex_product AS plexProduct FROM tv_device WHERE plex_machine_identifier = ?")
    .get(plexMachineIdentifier) as TvDevice;
  return row;
}

export function removeDevice(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM tv_device WHERE id = ?").run(id);
}
