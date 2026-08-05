-- Configured cast targets for "Open on Plex" (docs/PROTOCOL.md §7). Global,
-- not room-scoped — the same physical TVs are shared across every session on
-- this Binger instance. Discovery-only for now: rows come from picking a
-- currently-open Plex client, so there's nothing here yet about how to launch
-- an app on the device (see PROTOCOL §7's "what was deliberately left out").
CREATE TABLE tv_device (
  id                      TEXT PRIMARY KEY,
  name                    TEXT NOT NULL,
  plex_machine_identifier TEXT NOT NULL UNIQUE,
  plex_product            TEXT,
  created_at              INTEGER NOT NULL
);
