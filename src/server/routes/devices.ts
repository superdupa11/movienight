import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ScannedPlexClient, TvDevice } from "../../shared/types.js";
import { addDevice, listDevices, removeDevice, updateDevice } from "../db/devices.js";
import { listPlayers } from "../plex/playback.js";

// Loose on purpose: accepts a plain IP or a LAN hostname (mDNS names like
// `tv.local` work fine for Samsung's local REST API too), just not garbage.
const ipAddressSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[a-zA-Z0-9.-]+$/, "Not a valid IP or hostname");

const addDeviceSchema = z.object({
  name: z.string().trim().min(1).max(60),
  plexMachineIdentifier: z.string().min(1),
  plexProduct: z.string().nullable(),
});

const updateDeviceSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    ipAddress: z.union([ipAddressSchema, z.literal("")]).nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.ipAddress !== undefined, "Nothing to update");

/**
 * Device management for "Open on Plex" (PROTOCOL §7). Scanning surfaces
 * whatever Plex client is currently open on the network; saved devices can
 * be renamed to something recognizable, and casting targets whichever saved
 * device is currently active (see Room.openOnTv).
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

  app.patch("/api/devices/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = updateDeviceSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Malformed update" });
    const { name, ipAddress } = parsed.data;
    const device = updateDevice(db, id, {
      name,
      ipAddress: ipAddress === undefined ? undefined : ipAddress || null,
    });
    if (!device) return reply.code(404).send({ error: "Not found" });
    return device;
  });

  app.delete("/api/devices/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    removeDevice(db, id);
    return reply.code(204).send();
  });
}
