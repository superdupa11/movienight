import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { Server as SocketIOServer } from "socket.io";
import { config } from "./config.js";
import { getDb } from "./db/index.js";
import { startIngestScheduler } from "./plex/scheduler.js";
import { registerArtRoutes } from "./routes/art.js";
import { registerHealthzRoute } from "./routes/healthz.js";
import { registerLibraryRoutes } from "./routes/library.js";
import type { AppServer } from "./rooms/ioTypes.js";
import { registerSocketHandlers } from "./rooms/socketHandlers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// dist/server/index.js -> ../client is dist/client, where the Vite build lands.
const CLIENT_DIST = join(__dirname, "../client");

async function main() {
  const db = getDb();

  const app = Fastify({ logger: true });

  registerHealthzRoute(app);
  registerArtRoutes(app);
  registerLibraryRoutes(app, db);

  await app.register(fastifyStatic, {
    root: CLIENT_DIST,
    wildcard: false,
  });

  app.setNotFoundHandler((req, reply) => {
    if (req.method === "GET" && !req.url.startsWith("/art/")) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: "not found" });
  });

  await app.ready();

  const io: AppServer = new SocketIOServer(app.server, { path: "/socket.io" });
  registerSocketHandlers(io, db);

  startIngestScheduler(db);

  await app.listen({ port: config.port, host: "0.0.0.0" });
  app.log.info(`Movie Night listening on :${config.port}`);
}

main().catch((err) => {
  console.error("[server] fatal startup error:", err);
  process.exit(1);
});
