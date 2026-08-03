import { getDb } from "../db/index.js";
import { runNightlyIngest } from "./ingest.js";

const db = getDb();
console.log("[ingest] starting Plex sync…");
const summary = await runNightlyIngest(db);
console.log("[ingest] done", summary);
db.close();
