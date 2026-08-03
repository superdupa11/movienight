# Movie Night

Self-hosted web app for picking a movie by group vote against a Plex library.
Runs as a single Docker container on Unraid.

**`docs/PROTOCOL.md` is the spec and the source of truth.** Read it before writing
code. If an implementation detail contradicts it, the spec wins — raise the conflict
rather than silently diverging.

## Stack

- **Runtime:** Node 22 LTS, TypeScript, ESM
- **Server:** Fastify + socket.io
- **DB:** SQLite via `better-sqlite3` (single file at `/data/movienight.db`)
- **Client:** React + Vite, Tailwind
- **Build:** one container serves the API, the WebSocket, and the built SPA

## Layout

```
src/
  server/
    plex/          ingest client, genre→category mapping, poster transcode
    deck/          filter query, deckHash cache, prewarm
    rooms/         state machine, socket handlers
    db/            schema + migrations
  client/
    lobby/         category picker, people typeahead, join QR
    voting/        swipe deck, card front/back
    reveal/        match screen
docs/PROTOCOL.md
```

## Commands

```bash
npm run dev          # vite + server with watch
npm run build        # client bundle + server tsc
npm run ingest       # one-off Plex sync (also runs nightly via cron in-container)
npm test
```

## Invariants — do not violate these

1. **The Plex token never reaches the browser.** Posters and backdrops are served
   from our own `/art/:id` path off the local cache. No Plex URL is ever sent to a
   client.
2. **The server is authoritative.** Clients emit intents and render snapshots.
   Never trust a client-supplied deck index, vote count, or phase.
3. **Match detection is `Set.size === connectedPlayerCount`.** Never scan the deck.
   See PROTOCOL §6 for the disconnect grace window — this is subtle, read it.
4. **Vote counts stay hidden during VOTING.** Broadcast cursor position only.
5. **No per-request Plex calls.** All enrichment happens in the nightly ingest.
   A request path that hits `/library/metadata/...` is a bug.

## Conventions

- Socket event names are `domain:action`, matching PROTOCOL §4 and §5 exactly.
- All timestamps are epoch ms integers.
- Config comes from env only; see `.env.example`. Nothing hardcoded.
- Prefer `better-sqlite3` prepared statements at module scope over building SQL
  per call.

## Target platform

Built on Apple Silicon, deployed to Unraid (linux/amd64). `better-sqlite3` is a
native module, so images must be built with `--platform linux/amd64` — see README.
Don't add native dependencies without flagging it.
