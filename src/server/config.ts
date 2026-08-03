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
  port: Number(optional("PORT", "8080")),
  publicUrl: optional("PUBLIC_URL", "http://localhost:8080").replace(/\/+$/, ""),
  dbPath: optional("DB_PATH", "./data/movienight.db"),
  artCacheDir: optional("ART_CACHE_DIR", "./data/art"),
  ingestCron: optional("INGEST_CRON", "0 4 * * *"),
  sessionSecret: required("SESSION_SECRET"),
  tz: optional("TZ", "UTC"),
};
