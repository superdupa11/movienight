import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export type TvDevice = {
  id: string;
  name: string;
  plexMachineIdentifier: string;
  plexProduct: string | null;
  ipAddress: string | null;
};

const SELECT_COLUMNS =
  "SELECT id, name, plex_machine_identifier AS plexMachineIdentifier, plex_product AS plexProduct, ip_address AS ipAddress FROM tv_device";

export function listDevices(db: Database.Database): TvDevice[] {
  return db.prepare(`${SELECT_COLUMNS} ORDER BY created_at`).all() as TvDevice[];
}

export function addDevice(db: Database.Database, name: string, plexMachineIdentifier: string, plexProduct: string | null): TvDevice {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO tv_device (id, name, plex_machine_identifier, plex_product, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (plex_machine_identifier) DO UPDATE SET name = excluded.name, plex_product = excluded.plex_product`,
  ).run(id, name, plexMachineIdentifier, plexProduct, Date.now());
  return db.prepare(`${SELECT_COLUMNS} WHERE plex_machine_identifier = ?`).get(plexMachineIdentifier) as TvDevice;
}

export function updateDevice(
  db: Database.Database,
  id: string,
  updates: { name?: string; ipAddress?: string | null },
): TvDevice | undefined {
  if (updates.name !== undefined) {
    db.prepare("UPDATE tv_device SET name = ? WHERE id = ?").run(updates.name, id);
  }
  if (updates.ipAddress !== undefined) {
    db.prepare("UPDATE tv_device SET ip_address = ? WHERE id = ?").run(updates.ipAddress, id);
  }
  return db.prepare(`${SELECT_COLUMNS} WHERE id = ?`).get(id) as TvDevice | undefined;
}

export function removeDevice(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM tv_device WHERE id = ?").run(id);
}

// `remote_token` deliberately isn't part of `TvDevice`/`SELECT_COLUMNS` above
// — it's a bearer credential for the TV's WS remote-control channel (§7.2),
// read and written only by the sleep-timer's pairing flow, never sent to a
// client.
export function getRemoteToken(db: Database.Database, id: string): string | null {
  const row = db.prepare("SELECT remote_token FROM tv_device WHERE id = ?").get(id) as { remote_token: string | null } | undefined;
  return row?.remote_token ?? null;
}

export function setRemoteToken(db: Database.Database, id: string, token: string): void {
  db.prepare("UPDATE tv_device SET remote_token = ? WHERE id = ?").run(token, id);
}
