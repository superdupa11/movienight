# Binger — Room State Machine & WebSocket Protocol

Unanimous-match, self-paced (no timer). Server is authoritative for all state;
clients render snapshots and emit intents.

**Flow:** host creates session → sets filters (category, director, cast, runtime)
→ voters join by code/QR → everyone swipes at their own pace → first unanimous
yes ends the round and reveals the winner on every screen.

Filters stay host-editable while people join rather than locking at creation. Party
size changes what's tolerable — a 140-minute pick that works for two people doesn't
work for six — and the host should be able to react to who actually showed up.

---

## 1. Room State Machine

```
                  host: session:start
   ┌────────┐    (>=2 players, deck>0)   ┌──────────┐
   │ LOBBY  ├──────────────────────────► │ BUILDING │
   └────┬───┘                            └────┬─────┘
        │                                     │ deck ready (auto)
        │ all players leave                   ▼
        │                                ┌─────────┐
        │                                │ VOTING  │
        │                                └──┬───┬──┘
        │                     unanimous yes │   │ every player exhausted deck
        │                                   ▼   ▼
        │                            ┌─────────┐ ┌────────┐
        │                            │ MATCHED │ │ RUNOFF │
        │                            └────┬────┘ └───┬────┘
        │                                 │          │ plurality pick
        │                                 ▼          ▼
        │                              ┌──────────────┐
        └─────────────────────────────►│   RESOLVED   │
                                       └──────┬───────┘
                                              │ host: session:reset
                                              └──────────► LOBBY
```

| State | Room locked? | Who can act | Exit condition |
|---|---|---|---|
| `LOBBY` | no | anyone joins; host sets filters | host starts (≥2 players, deck ≥ 8, `warm === 'READY'`) |
| `BUILDING` | yes | nobody | all clients `client:ready`, or 3s timeout (§3) |
| `VOTING` | yes | all players vote | unanimous yes, or all decks exhausted |
| `MATCHED` | yes | host only | auto-advance after client ack |
| `RUNOFF` | yes | all players pick 1 of 5 | all picks in, or host forces |
| `RESOLVED` | yes | host resets | host `session:reset` |

**Locked** means `room:join` is rejected with `ERR_ROOM_LOCKED`. Rejoins with a
valid token are always allowed regardless of state.

---

## 2. Server State Shape

```ts
type RoomState = {
  code: string;                    // 4 chars, A-Z minus vowels (no accidental words)
  phase: 'LOBBY' | 'BUILDING' | 'VOTING' | 'MATCHED' | 'RUNOFF' | 'RESOLVED';
  hostId: string;
  players: Map<string, Player>;
  filters: DeckFilters;
  deck: Movie[];                   // same order for everyone
  yeses: Map<number, Set<string>>; // deckIndex -> userIds who liked it
  result?: { movie: Movie; via: 'match' | 'runoff' };
  createdAt: number;
};

type Player = {
  id: string;
  name: string;
  connected: boolean;
  graceUntil?: number;             // set on disconnect; see §6
  cursor: number;                  // next unvoted deck index
};

type DeckFilters = {
  category: CategoryId | 'ALL';    // primary selector, see §3
  directors?: number[];            // personIds, OR within facet
  cast?: number[];                 // personIds, OR within facet
  maxRuntime?: number;             // minutes
  unwatchedOnly?: boolean;
  yearMin?: number;
  yearMax?: number;
  limit: number;                   // default 40, hard cap 100
};

type Movie = {
  id: string;                      // Plex ratingKey
  title: string;
  year: number;
  runtime: number;                 // minutes (Plex gives ms — divide at ingest)
  genres: string[];                // raw Plex tags
  categories: CategoryId[];        // mapped, see §3
  contentRating?: string;          // "PG-13"

  // Card face
  posterUrl: string;               // YOUR proxy path, never a Plex URL w/ token
  backdropUrl?: string;            // Plex `art`, for the expanded view

  // Card back — the "profile"
  tagline?: string;
  summary: string;
  directors: string[];
  cast: string[];                  // top 3 only; more is noise at a glance
  audienceRating?: number;         // 0–10
  criticRating?: number;           // 0–10
  unwatched: boolean;              // viewCount === 0
};
```

`yeses` is the whole matching engine. Never scan the deck.

---

## 3. Deck Building: Categories, People & Prewarm

### Why not use Plex genres directly

Plex genre tags come from the metadata agent and are messy: inconsistent
granularity (`Sci-Fi` vs `Science Fiction` vs `Fantasy`), long tails of one-movie
tags, and near-universal multi-tagging — most comedies are also tagged `Drama` or
`Romance`. A raw genre list makes a terrible picker.

Map to a curated set at ingest time and store it on the row:

| `CategoryId` | Matches any Plex tag in |
|---|---|
| `COMEDY` | Comedy, Stand-up Comedy, Parody |
| `ROMANCE` | Romance, Romantic Comedy |
| `ACTION` | Action, Adventure, War, Martial Arts |
| `HORROR` | Horror, Slasher |
| `SCIFI_FANTASY` | Science Fiction, Sci-Fi, Fantasy |
| `THRILLER` | Thriller, Mystery, Crime, Suspense |
| `DRAMA` | Drama, Biography, History |
| `FAMILY` | Animation, Family, Children |
| `DOCUMENTARY` | Documentary |

Matching is OR across tags, and a movie lands in **multiple** categories — that's
intended. A rom-com should surface under both. `ALL` skips the filter entirely.

### Category selection is the create-session flow

Show the picker with live counts, so the host can't pick an empty room:

```ts
// server → client on join and after any filter change
type CategoryOption = { id: CategoryId; label: string; count: number };
```

Grey out anything under 5. Counts are computed against the *other* active filters
(runtime, unwatched), so if `unwatchedOnly` guts your Horror shelf, the host sees it
before starting rather than 20 seconds into a dead deck.

### People filters will collapse your deck

This is the one that needs guarding. Category filters leave you 40+ candidates on a
typical library. People filters don't: on ~800 movies, a given director is usually
3–9 titles and a given actor 5–15. AND those together with a category and you land
on 2 or 3 — and a 3-card deck under unanimity is a coin flip on whether movie night
happens at all.

Rules that keep it usable:

- **OR within a facet, AND across facets.** Two directors selected means "either
  one." Director + category means both must hold.
- **Hard floor of 8 to start.** Below that, block `session:start` with
  `ERR_DECK_TOO_SMALL` and say which chip is doing the damage.
- **Live count on every chip.** As the host adds Fincher, the category counts
  recompute. Watching Comedy drop from 112 to 1 explains the problem better than
  any error message.
- **Default the facet closed.** Category is the primary axis; people are an
  optional refinement behind a "narrow by cast or director" disclosure. Most
  sessions shouldn't touch it.

### People need a real table, not a JSON column

Storing `cast: string[]` on the movie row was fine for card display. Filtering and
autocomplete need the join:

```sql
CREATE TABLE person (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  plex_tag_id  INTEGER UNIQUE          -- Plex Role/Director tag id, for dedupe
);

CREATE TABLE movie_person (
  movie_id   TEXT NOT NULL,
  person_id  INTEGER NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('DIRECTOR','ACTOR')),
  billing    INTEGER,                  -- Plex tag order; lower = top-billed
  PRIMARY KEY (movie_id, person_id, role)
);

CREATE INDEX idx_mp_person ON movie_person (person_id, role);
```

Dedupe on Plex's tag id, not on name — the metadata agent is generally consistent
there, whereas name matching will happily merge two different Chris Evanses.

Typeahead should only offer people who appear in **2 or more** movies. A single-
credit actor is a guaranteed dead end, and suggesting them is the app inviting the
host to break it.



### Caching the resolved deck

Cache on a hash of the filters, not on the room:

```ts
deckHash = sha1(canonicalize(filters) + libraryVersion)
// libraryVersion = MAX(updated_at) from the movies table — a nightly
// ingest run bumps it and invalidates every cached deck for free.

type CachedDeck = {
  movieIds: string[];        // pre-shuffle; deck order is per-session
  warmedAt: number;
  assetsReady: boolean;
};
```

Two things fall out of hashing the filters rather than the session. Repeat
sessions with the same settings — "Comedy, under 100 minutes," which is most
Friday nights — hit warm. And two hosts on the same box share the cache.

Keep the shuffle out of the cache. Cache the qualifying *set*; shuffle per session
with a per-room seed, or the same night twice running deals identical cards.

### What actually needs warming

Not much, if the nightly cron is doing its job. Posters and backdrops are already
transcoded to webp on disk from step 6, so session-time "warming" is a disk check,
not a transcode. The exceptions are movies added to Plex since the last run, and a
cold first boot.

So prewarm is three cheap things:

1. Run the filter query → `movieIds`. Indexed columns on ~800 rows, single-digit ms.
2. `stat()` the webp for each poster + backdrop. Transcode only the misses.
3. Emit a preload manifest of asset URLs.

Step 2 is also your broken-art check. A movie whose thumb never downloaded should
be dropped from the deck at build time rather than showing up as a grey rectangle
that nobody votes yes on.

### Don't gate joining — gate starting

Blocking the room code until assets are ready costs you the exact window people
need to unlock their phones and find the QR. Open joining immediately; make
`session:start` the thing that waits.

Add to `RoomState`:

```ts
deckHash: string;
warm: 'COLD' | 'WARMING' | 'READY';
warmProgress: { done: number; total: number };
```

Recompute on a 400ms debounce as the host adjusts filters, so a burst of chip taps
triggers one build. `session:start` returns `ERR_DECK_COLD` unless `warm === 'READY'`,
which means the host physically cannot start into a janky deck — and it preserves
editable filters, since re-warming after a late change takes under a second on a
warm cache.

### The client readiness barrier

This is where the seamlessness actually comes from. Server-side warm assets don't
help if six phones start fetching posters the instant `deck:dealt` lands — the
first card is blank on the slowest connection in the room.

In `BUILDING`, send the manifest, have each client preload the first 5 posters into
the browser cache, then emit `client:ready`. Advance to `VOTING` when all clients
ack **or** 3 seconds elapse, whichever comes first. The timeout matters: one person
on bad wifi shouldn't hold the room hostage, and they'll just see a brief spinner
on card one.



### Card anatomy

Two layers, because everything at once is unreadable at swipe speed and a bare
poster is useless for a movie nobody recognizes.

**Front (always visible):** poster fills the card at 2:3, with a bottom gradient
overlay carrying title, year, runtime, content rating, and 2–3 category chips.

**Back (tap, or swipe up):** backdrop image dimmed behind tagline, summary,
director, top 3 cast, and audience rating. Flip is per-card and resets on advance.

Keep the summary to ~3 lines collapsed with a "more" affordance. Plex summaries run
long and occasionally spoil third acts — a 400-character clamp is a decent
spoiler guard for free.

### The ingest gotcha

`/library/sections/{key}/all` gives you title, year, duration, summary, thumb, art,
contentRating, rating, audienceRating, viewCount, and Genre tags in one call. It
does **not** give you cast or directors. Those need `/library/metadata/{ratingKey}`
per movie — an N+1 that's fine nightly and disastrous at deck-build time.

Do all enrichment in the cron job, never on the request path:

```
nightly:
  1. GET /library/sections                  -> movie-type section keys
  2. GET /library/sections/{key}/all        -> base rows (1 call)
  3. for each new/changed ratingKey:
       GET /library/metadata/{ratingKey}    -> Role + Director tags
  4. map genres -> categories
  5. upsert person + movie_person from the tags (dedupe on plex_tag_id)
  6. fetch thumb + art, transcode to webp, cache to disk
  7. upsert movies
```

Step 6 matters more than it looks. Forty posters loading from a cold Plex
transcoder is a visibly janky first card. Cache them as ~400×600 webp on disk and
serve from your own static path. On the client, preload the next 3 posters — with
no timer, people swipe fast enough to outrun lazy loading.

---

## 4. Client → Server Events

| Event | Payload | Valid in | Notes |
|---|---|---|---|
| `room:create` | `{ name }` | — | Returns code + session token |
| `room:join` | `{ code, name, token? }` | `LOBBY`, or any phase w/ valid token | Token present = rejoin |
| `room:leave` | `{}` | any | Explicit; distinct from disconnect |
| `lobby:filters` | `DeckFilters` | `LOBBY` | Host only. Server replies with preview count |
| `people:search` | `{ q, role }` | `LOBBY` | Host only. Typeahead, min 2 chars |
| `session:start` | `{}` | `LOBBY` | Host only |
| `client:ready` | `{ deckHash }` | `BUILDING` | Ack after preloading first 5 posters |
| `card:flip` | `{ idx }` | `VOTING` | Optional telemetry — tells you which posters don't sell |
| `vote:cast` | `{ idx, liked }` | `VOTING` | Idempotent per `(userId, idx)` |
| `vote:undo` | `{ idx }` | `VOTING` | Optional; see §6 |
| `runoff:pick` | `{ movieId }` | `RUNOFF` | One per player, changeable until all in |
| `session:reset` | `{}` | `RESOLVED` | Host only; keeps players, clears votes |

Reject any host-only event from a non-host with `ERR_NOT_HOST` rather than
silently ignoring — you'll want the log line when the UI lets something through.

---

## 5. Server → Client Events

| Event | Payload | Sent to |
|---|---|---|
| `room:state` | full `RoomStateDTO` | joiner/rejoiner only |
| `player:joined` | `{ id, name }` | others |
| `player:left` | `{ id, reason }` | all |
| `player:presence` | `{ id, connected }` | all |
| `people:results` | `{ q, people: {id,name,movieCount}[] }` | host only |
| `lobby:categories` | `CategoryOption[]` | all — recomputed on every filter change |
| `lobby:preview` | `{ deckSize, category }` | all (so guests see the trim too) |
| `lobby:warming` | `{ warm, done, total }` | all — drives the host's start button |
| `deck:manifest` | `{ deckHash, assetUrls }` | all, on entering `BUILDING` |
| `deck:dealt` | `{ movies, phase: 'VOTING' }` | all |
| `progress:update` | `{ id, cursor, total }` | all, throttled 250ms |
| `match:found` | `{ movie, idx }` | all |
| `runoff:start` | `{ candidates: {movie, yesCount}[] }` | all |
| `runoff:tally` | `{ picksIn, total }` | all — counts only, not who |
| `runoff:result` | `{ movie, votes }` | all |
| `error` | `{ code, message }` | offender |

**`room:state` is your reconnect story.** One handler that replaces client state
wholesale, used on join *and* rejoin. Don't write a separate resync path.

---

## 6. The Parts That Will Bite You

### Disconnects change the quorum

Unanimity is `set.size === connectedPlayerCount`. If someone's phone sleeps mid-deck
and you decrement immediately, a match can fire on stale votes from four people who
never saw the winner. Use a grace window:

```ts
onDisconnect(userId) {
  player.connected = false;
  player.graceUntil = Date.now() + 90_000;
  broadcast('player:presence', { id: userId, connected: false });
  scheduleQuorumRecheck(90_000);
}
```

After the window, drop them for real, recompute quorum, then re-evaluate every
pending `yeses` set — a departure can instantly complete a match that was blocked
only by the person who left. That's correct behavior, but surface it in the UI as
"Matched after Dave dropped" so it doesn't look like a bug.

### Vote counts stay blind

Only broadcast `cursor` position, never `yesCount`, during `VOTING`. Visible tallies
turn the round into a bandwagon and you stop measuring actual preference. Counts
appear for the first time on the runoff screen, where they're the point.

### Runoff candidates

On `deck:exhausted`, take the top 5 indexes by `yeses[idx].size`, descending.
Tiebreak by lower deck index (stable, and the shuffle already randomized it).
If fewer than 2 movies got *any* yes, skip the runoff and go straight to
`RESOLVED` with a "nobody liked anything — widen your filters" state. It'll happen
the first time someone sets `maxRuntime: 90`.

### Undo is optional but cheap

`vote:undo` matters because self-paced voting means people swipe fast and
misfire. It's a `set.delete()` plus a cursor decrement. The only rule: reject undo
once `phase !== 'VOTING'`, or you'll get a race where someone un-likes the movie
that just won.

### Idempotent votes

Clients retry on flaky wifi. Key votes on `(userId, idx)` so a duplicate `vote:cast`
is a no-op rather than a double-count — this matters because `Set.add` is naturally
idempotent but your cursor increment isn't.

### The reveal screen

`match:found` fires on the Nth yes and every screen switches at once — that
simultaneity is the payoff, so don't gate it behind per-client animation timing.

Lead with the **backdrop**, not the poster. Plex `art` is 16:9 and fills a phone or
TV cleanly; the 2:3 poster letterboxes badly full-screen. Poster goes inset as a
thumbnail beside the title, year, and runtime, which keeps the box art the host
asked for without fighting the layout.

Two primary affordances and no more: "Start over" (host only, → `session:reset`)
and a deep link to the title in Plex. Anything else and people stand around
reading instead of pressing play.

**Deviation from the literal rule above:** every viewer (host and guests) also
gets a quiet, secondary "Leave room" control (→ `room:leave`, valid in any
phase per §4) on the reveal and empty-resolved screens. Once a movie is picked,
a guest has no reason to keep a session open, and making them wait on the host
to `session:reset` just to close the tab is a worse experience than the extra
button. Kept visually subordinate to the two primary actions so it doesn't
compete with them.

### Leaving after resolution notifies the room

`player:left` (§5) is already broadcast to `all`, not just the host — that's
what a client uses to drive a transient "Guest 2 left the room" notice. This
matters most right after resolution: the host is choosing whether to
`session:reset`, and losing a player changes who's around for the next round.
Surface it as a short-lived, room-wide banner rather than folding it into a
per-screen player list, since RESOLVED/MATCHED screens don't render one.

---

## 7. Casting to a Plex Client ("Open on Plex")

Host-only action from the reveal screen (`RESOLVED`): launch Plex on a
configured TV and cue the matched/runoff-winning title. Single hardcoded TV
for now (`SAMSUNG_TV_HOST` env var) — no device picker, since there's nothing
to pick between yet. The existing `plexUrl` deep link (§6) stays as the
default/fallback affordance; this is additive.

Everything below was verified against a real Samsung TV + PMS, not assumed —
the exact requests differ from what the general shape of "Plex remote control"
suggests, in ways that would have been wrong to just guess (see the two
`playOnDevice` gotchas below).

### Sequence

1. **Launch the app.** Samsung's *local REST API* — `POST
   https://{tvHost}:8002/api/v2/applications/{plexAppId}` — not the WebSocket
   remote-control API. `ed.apps.launch` over WebSocket silently no-ops on this
   TV's firmware; REST is what actually works. The TV serves a self-signed
   cert on its local API; trust comes from being on the LAN, not from cert
   validation.
2. **Wait for Plex to register.** Poll PMS `GET /clients` for a client with
   `playback` in `protocolCapabilities`. In the normal case (already signed
   in) this takes a few seconds. If nothing shows up within 15s, broadcast
   `plex:castStatus: WAITING_FOR_SIGNIN` — the Plex app likely needs a PIN
   login (plex.tv/link), which is not auto-solved (see callout below). Give up
   after 120s total with `plex:castStatus: ERROR`.
3. **Cue the title**, once a client appears — see `playOnDevice` below.

### `playOnDevice`: two non-obvious requirements

Found only by testing against the real client, not documented anywhere:

- **This client reports its own address as `127.0.0.1`.** ("Plex for
  Samsung"'s `/clients` entry — not a proxy artifact, just what it announces.)
  Commands must be proxied through PMS using the
  `X-Plex-Target-Client-Identifier` header, never sent to the client's
  self-reported address directly.
- **The client rejects the account's own token on this endpoint.** It needs a
  scoped, single-use "delegation" token minted just for this call: `GET
  /security/token?type=delegation&scope=all` on PMS, using the normal account
  token, returns `{ token: "transient-..." }`. *That* token — not
  `X-Plex-Token` — goes on the `playMedia` call.

Full recipe:

```
1. GET  {pms}/security/token?type=delegation&scope=all&X-Plex-Token={account token}
   -> delegationToken

2. POST {pms}/playQueues?type=video
        &uri=server://{pmsMachineIdentifier}/com.plexapp.plugins.library/library/metadata/{ratingKey}
        &X-Plex-Token={account token}
   -> playQueueID

3. GET  {pms}/player/playback/playMedia
        ?key=/library/metadata/{ratingKey}
        &machineIdentifier={pmsMachineIdentifier}&address={pmsHost}&port={pmsPort}&protocol=http
        &type=video&providerIdentifier=com.plexapp.plugins.library
        &containerKey=/playQueues/{playQueueID}?own=1&window=100
        &commandID={n}&token={delegationToken}
   Header: X-Plex-Target-Client-Identifier: {client machineIdentifier}
```

A bare `key=` without a `containerKey` pointing at a real PlayQueue gets a 400
from the client — real Plex clients always play from a queue, even for a
single item.

### 7.1 Targeting the right client — the `tv_device` table

An earlier version of `castToTv` picked whichever client `listPlayers()`
returned first with `playback` in its capabilities — reasonable-looking, and
correct as long as exactly one Plex client was ever on the network at once,
which was true for every test that night. It broke the first time a second
TV (a different physical Samsung, "TV 2024") was also on with Plex open:
`/clients` then returned multiple entries, in an order this app never
controlled, and the wrong TV — or via a duplicate-registration quirk we saw
in PMS's own response (the same physical client listed twice, once via PMS's
IP and once via `127.0.0.1`), seemingly both — ended up playing.

The fix: `castToTv` takes a specific `plexMachineIdentifier` and matches on
it exactly (`d.id === plexMachineIdentifier && d.canPlay`), never "first
match." That identifier comes from the `tv_device` table (§7's device
management, previously discovery-only/unwired) — `Room.openOnTv` looks up
`listDevices(db)[0]` and passes its `plexMachineIdentifier` through. Whoever
sets `SAMSUNG_TV_HOST` (for launching) is expected to also save that same
physical TV via Manage Devices (for Plex-side targeting) — the two aren't
cross-validated against each other, so a mismatch just means "the app
launches, casting never finds a match" rather than a wrong-TV mistake.

### The PIN sign-in gap is deliberate, not a TODO

Plex TV apps authenticate via a device-linking flow (a 4-character code +
plex.tv/link), not the account token. If the TV's Plex app is ever signed
out, `castToTv` will sit in `WAITING_FOR_SIGNIN` until someone completes that
manually and the client registers, or it times out. This was investigated and
deliberately not automated: it's plausible the server's own admin token could
complete the link programmatically (mirroring what a human does at
plex.tv/link), but the PIN screen likely exists specifically so a leaked
token can't silently authorize new devices — bypassing it wasn't something to
assume our way past. Manual resolution, with a generous wait window, is the
correct behavior here, not a gap to close later.

In practice this should be rare regardless — a signed-in device's token
doesn't expire on its own, only on an explicit sign-out, a revoke from the
Plex account's device list, a factory reset, or a password change. On the
TV itself, **Plex's own app settings have an "automatic sign-in" option** —
enabling it is the actual operational fix, since it addresses the cause
(the TV's session not surviving) rather than the symptom.

### Events

| Event | Direction | Payload | Valid in | Notes |
|---|---|---|---|---|
| `plex:openOnTv` | client → server | `{}` | `RESOLVED` | Host only. Server casts `result.movie` — never a client-supplied id (invariant #2) |
| `plex:castStatus` | server → client | `{ state: 'LAUNCHING' \| 'WAITING_FOR_SIGNIN' \| 'PLAYING' \| 'ERROR', message?: string }` | — | Broadcast to the room, not just the host — matches `match:found`'s shared-ceremony framing |

### What was deliberately left out (YAGNI, not forgotten)

- **Waking the TV from standby.** Extensively investigated — Wake-on-LAN
  does not work on this TV/network despite exhausting every reasonable
  packet variant, and the working local mechanism (used by the SmartThings
  app) could not be replicated without either a Samsung account-level cloud
  dependency or unconfirmed BLE reverse-engineering. The pragmatic fix is an
  IR blaster (Broadlink RM4 mini or similar) replaying the TV remote's
  power-on code — not yet implemented. `castToTv` assumes the TV is already
  on.
- **A device picker.** `plex:openOnTv` takes no target — it always targets
  the first row in `tv_device` (§7.1). That table only ever has one
  meaningfully-configured row right now, so there's nothing to pick between
  yet. A `plex:devices` request/response pair for choosing among several
  saved devices is real future work, not implemented, if a second TV is ever
  actually cast to (as opposed to merely sharing the network — see the
  `d.canPlay` bug note in §7.1) — building a picker UI now would be
  speculative.

---

## 8. Suggested Wire Setup

- `socket.io` for automatic reconnect + room broadcast semantics. Plain `ws` is
  fine but you'll rewrite reconnect backoff yourself.
- Session token: signed JWT in `localStorage`, 6h expiry, contains `{ roomCode, userId }`.
  Survives refresh, which is the #1 way people leave a room by accident.
- Rooms in a plain `Map` on the process. Add a 4h sweeper for abandoned rooms.
  No Redis unless you want sessions to survive a container restart — for movie
  night, they don't need to.
