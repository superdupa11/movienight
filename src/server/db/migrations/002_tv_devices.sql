-- Configured cast targets for "Open on Plex" (docs/PROTOCOL.md §7). Global,
-- not room-scoped — the same physical TVs are shared across every session on
-- this Binger instance. Rows come from picking a currently-open Plex client
-- and can be renamed; casting cross-references this table against Plex's
-- live /clients list to find whichever saved device is actually active
-- (§7.1) — there's still no per-row launch mechanism (see PROTOCOL §7's
-- "what was deliberately left out").
CREATE TABLE tv_device (
  id                      TEXT PRIMARY KEY,
  name                    TEXT NOT NULL,
  plex_machine_identifier TEXT NOT NULL UNIQUE,
  plex_product            TEXT,
  created_at              INTEGER NOT NULL
);
