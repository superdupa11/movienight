-- Movies: base rows from /library/sections/{key}/all plus enrichment from
-- /library/metadata/{ratingKey} (directors/cast land in movie_person, not here).
CREATE TABLE movies (
  id              TEXT PRIMARY KEY,        -- Plex ratingKey
  title           TEXT NOT NULL,
  year            INTEGER,
  runtime         INTEGER NOT NULL DEFAULT 0,  -- minutes (Plex gives ms)
  genres          TEXT NOT NULL DEFAULT '[]',  -- JSON array, raw Plex tags
  categories      TEXT NOT NULL DEFAULT '[]',  -- JSON array of CategoryId, for card DTO
  content_rating  TEXT,
  tagline         TEXT,
  summary         TEXT NOT NULL DEFAULT '',
  audience_rating REAL,
  critic_rating   REAL,
  view_count      INTEGER NOT NULL DEFAULT 0,
  plex_thumb_path TEXT,                    -- Plex-relative path, for on-demand re-transcode
  plex_art_path   TEXT,
  plex_updated_at INTEGER NOT NULL DEFAULT 0,  -- Plex's own updatedAt (epoch s); change-detects for §3 step 3
  has_poster      INTEGER NOT NULL DEFAULT 0,
  has_backdrop    INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL         -- epoch ms; MAX(updated_at) = libraryVersion
);

CREATE INDEX idx_movies_updated_at ON movies (updated_at);

-- Normalized category membership, for indexed filtering + live counts.
-- `categories` JSON on the movie row above is the display copy; this table
-- is the query path.
CREATE TABLE movie_category (
  movie_id    TEXT NOT NULL REFERENCES movies (id) ON DELETE CASCADE,
  category_id TEXT NOT NULL,
  PRIMARY KEY (movie_id, category_id)
);

CREATE INDEX idx_mc_category ON movie_category (category_id);

CREATE TABLE person (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  plex_tag_id INTEGER UNIQUE          -- Plex Role/Director tag id, for dedupe
);

CREATE TABLE movie_person (
  movie_id   TEXT NOT NULL REFERENCES movies (id) ON DELETE CASCADE,
  person_id  INTEGER NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('DIRECTOR', 'ACTOR')),
  billing    INTEGER,                  -- Plex tag order; lower = top-billed
  PRIMARY KEY (movie_id, person_id, role)
);

CREATE INDEX idx_mp_person ON movie_person (person_id, role);
