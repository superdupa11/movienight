import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import type { LibrarySummaryDTO } from "../../shared/types.js";

const POSTER_SAMPLE_SIZE = 36;

/**
 * Backs the home screen's poster wall + "N titles" status line. Reads only
 * the local ingest cache (CLAUDE.md invariant #5) — no Plex call here.
 */
export function registerLibraryRoutes(app: FastifyInstance, db: Database.Database): void {
  const countStmt = db.prepare("SELECT COUNT(*) AS n FROM movies");
  const posterSampleStmt = db.prepare("SELECT id FROM movies WHERE has_poster = 1 ORDER BY RANDOM() LIMIT ?");

  app.get("/api/library/summary", async (): Promise<LibrarySummaryDTO> => {
    const totalTitles = (countStmt.get() as { n: number }).n;
    const posterIds = (posterSampleStmt.all(POSTER_SAMPLE_SIZE) as { id: string }[]).map((r) => r.id);
    return { totalTitles, posterIds };
  });
}
