# Movie Night — Build & Deploy

## 1. Claude Code on the Mac mini

Requires macOS 13.0+ and a Pro, Max, Team, Enterprise, or Console account — the
free Claude.ai plan doesn't include Claude Code access.

```bash
curl -fsSL https://claude.ai/install.sh | bash
claude --version          # expect something like 2.1.211 (Claude Code)
```

Homebrew works too (`brew install --cask claude-code`), but Homebrew installs
don't auto-update, while the native installer does. If `claude` isn't found after
install, restart your terminal — PATH hasn't refreshed in the current session.

## 2. Seed the repo

```bash
mkdir movienight && cd movienight
git init
mkdir -p docs
cp ~/Downloads/movie-night-protocol.md docs/PROTOCOL.md
cp ~/Downloads/CLAUDE.md ~/Downloads/Dockerfile ~/Downloads/docker-compose.yml .
git add -A && git commit -m "Spec and container scaffold"
claude
```

`CLAUDE.md` is read on every launch, so the invariants and the pointer to
`docs/PROTOCOL.md` are in context from the first message. Commit it — it's project
config, not scratch.

Build it in slices rather than one prompt. Roughly:

1. DB schema + migrations (PROTOCOL §2, §3 people tables)
2. Plex ingest + genre→category mapping + poster transcode
3. Deck query, `deckHash` cache, prewarm
4. Room state machine + socket handlers (§4, §5)
5. Client: lobby → voting → reveal

Commit between slices. The state machine is the part most worth reviewing closely
— the disconnect grace window in §6 is easy to get subtly wrong.

## 3. Build the image

**The Mac mini is arm64. Unraid is amd64.** `better-sqlite3` and `sharp` are native
modules, so an image built natively on the Mac will fail at runtime on Unraid with
an `invalid ELF header` error. Build for the target explicitly:

```bash
docker buildx create --use --name movienight-builder   # once
docker buildx build --platform linux/amd64 -t movienight:latest --load .
```

Cross-building under QEMU emulation is slow — a few minutes for the native module
compile. Two faster options if it annoys you:

- Push to a registry and build on the Unraid box directly (`docker build` there is
  native and fast).
- Add a GitHub Actions workflow that builds both arches on push and publishes to
  GHCR, then Unraid just pulls.

Verify before shipping:

```bash
docker image inspect movienight:latest --format '{{.Architecture}}'   # amd64
```

## 4. Deploy on Unraid

Transfer the image and start it:

```bash
docker save movienight:latest | gzip > movienight.tar.gz
scp movienight.tar.gz root@unraid:/tmp/
ssh root@unraid 'gunzip -c /tmp/movienight.tar.gz | docker load'
```

Then on Unraid, with `PLEX_TOKEN` and `SESSION_SECRET` in a `.env` beside the
compose file:

```bash
docker compose up -d
docker compose logs -f movienight
```

First boot runs a full ingest. On an ~800-movie library expect a few minutes,
mostly the per-title metadata calls for cast and directors.

### Networking notes

- `PLEX_URL` should be the LAN IP (`http://192.168.1.10:32400`), not `plex.tv`.
  Container name resolution only works if Plex is on the same user-defined bridge.
- The compose file joins an external `proxynet`. Point an NPM proxy host at
  `movienight:8080` and **enable Websockets Support** — without it the lobby
  connects and then silently never updates, which looks like an app bug.
- You're already doing DNS Challenge via Cloudflare for certs, so a
  `movie.walztech.net` host should just inherit the wildcard.

## 5. Getting your Plex token

Open any library item in Plex Web → **Get Info** → **View XML**. The token is the
`X-Plex-Token` query param on the resulting URL. Treat it like a password — it
grants full access to your server. It belongs in `.env`, which belongs in
`.gitignore`.
