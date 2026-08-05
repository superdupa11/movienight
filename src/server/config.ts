// Config comes from env only — see .env.example. Nothing hardcoded (CLAUDE.md).

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export const config = {
  plex: {
    url: required("PLEX_URL").replace(/\/+$/, ""),
    token: required("PLEX_TOKEN"),
    sections: (process.env.PLEX_LIBRARY_SECTIONS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },
  // "Open on Plex" — single hardcoded TV for now (see docs/PROTOCOL.md §7).
  // Blank = feature disabled; Room.openOnTv() rejects with ERR_BAD_REQUEST.
  tv: {
    samsungHost: process.env.SAMSUNG_TV_HOST || "",
  },
  port: Number(optional("PORT", "8080")),
  publicUrl: optional("PUBLIC_URL", "http://localhost:8080").replace(/\/+$/, ""),
  dbPath: optional("DB_PATH", "./data/movienight.db"),
  artCacheDir: optional("ART_CACHE_DIR", "./data/art"),
  ingestCron: optional("INGEST_CRON", "0 4 * * *"),
  sessionSecret: required("SESSION_SECRET"),
  tz: optional("TZ", "UTC"),
};
