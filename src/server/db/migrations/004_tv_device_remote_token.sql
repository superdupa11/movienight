-- Samsung's WebSocket remote-control channel (docs/PROTOCOL.md §7.2, used for
-- the sleep timer's KEY_POWER) pairs once per TV: the first connection pops
-- an on-screen "Allow this device?" prompt and returns a token that must be
-- replayed on future connections to skip re-prompting. Deliberately not part
-- of the `tv_device` shape returned to clients (see `getRemoteToken` /
-- `setRemoteToken` in db/devices.ts) — it's a bearer credential for the TV,
-- not something the browser needs or should see.
ALTER TABLE tv_device ADD COLUMN remote_token TEXT;
