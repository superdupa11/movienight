import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ScannedPlexClient, TvDevice } from "../../shared/types.js";
import { addDevice, listDevices, removeDevice } from "../db/devices.js";
import { listPlayers } from "../plex/playback.js";

const addDeviceSchema = z.object({
  name: z.string().trim().min(1).max(60),
  plexMachineIdentifier: z.string().min(1),
  plexProduct: z.string().nullable(),
});

/**
 * Device management for "Open on Plex" (PROTOCOL §7) — discovery-only for
 * this revision. Scanning surfaces whatever Plex client is currently open on
 * the network; there's no vendor-specific setup step here yet.
 */
export function registerDeviceRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get("/api/devices", async (): Promise<TvDevice[]> => listDevices(db));

  app.get("/api/devices/scan", async (): Promise<ScannedPlexClient[]> => {
    const players = await listPlayers();
    return players
      .filter((p) => p.canPlay)
      .map((p) => ({ plexMachineIdentifier: p.id, plexName: p.name, plexProduct: p.product }));
  });

  app.post("/api/devices", async (req, reply) => {
    const parsed = addDeviceSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Malformed device" });
    const { name, plexMachineIdentifier, plexProduct } = parsed.data;
    return addDevice(db, name, plexMachineIdentifier, plexProduct);
  });

  app.delete("/api/devices/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    removeDevice(db, id);
    return reply.code(204).send();
  });
}
