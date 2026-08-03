import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/**
 * PROTOCOL invariant: the Plex token never reaches the browser. Posters and
 * backdrops are served from our own cache — no Plex URL is ever sent to a client.
 */
export function registerArtRoutes(app: FastifyInstance): void {
  app.get("/art/:id/:kind", async (req, reply) => {
    const { id, kind } = req.params as { id: string; kind: string };
    if (!SAFE_ID.test(id) || (kind !== "poster.webp" && kind !== "backdrop.webp")) {
      return reply.code(404).send();
    }

    const suffix = kind === "poster.webp" ? "poster" : "backdrop";
    const path = `${config.artCacheDir}/${id}-${suffix}.webp`;
    try {
      await stat(path);
    } catch {
      return reply.code(404).send();
    }

    reply.header("Content-Type", "image/webp");
    reply.header("Cache-Control", "public, max-age=86400");
    return reply.send(createReadStream(path));
  });
}
