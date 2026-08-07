-- Per-device Samsung TV IP, so "Open on Plex" can launch the app on whichever
-- saved TV it needs to instead of the single SAMSUNG_TV_HOST env var (see
-- docs/PROTOCOL.md §7.1). NULL means this device can still be *cast to* while
-- already open, it just can't be auto-launched from cold.
ALTER TABLE tv_device ADD COLUMN ip_address TEXT;
