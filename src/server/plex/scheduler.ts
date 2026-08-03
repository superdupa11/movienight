import { Cron } from "croner";
import type Database from "better-sqlite3";
import { config } from "../config.js";
import { runNightlyIngest } from "./ingest.js";

let running = false;

/** In-container cron (INGEST_CRON) plus a run on cold boot when the library is empty. */
export function startIngestScheduler(db: Database.Database): void {
  new Cron(config.ingestCron, { timezone: config.tz }, () => {
    void runIngestSafely(db);
  });

  const { count } = db.prepare("SELECT COUNT(*) AS count FROM movies").get() as { count: number };
  if (count === 0) {
    console.log("[ingest] cold boot with empty library — running initial sync");
    void runIngestSafely(db);
  }
}

async function runIngestSafely(db: Database.Database): Promise<void> {
  if (running) {
    console.warn("[ingest] skipped — previous run still in progress");
    return;
  }
  running = true;
  try {
    console.log("[ingest] starting scheduled Plex sync…");
    const summary = await runNightlyIngest(db);
    console.log("[ingest] done", summary);
  } catch (err) {
    console.error("[ingest] failed:", err);
  } finally {
    running = false;
  }
}
