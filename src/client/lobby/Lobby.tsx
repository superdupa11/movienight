import { useEffect, useState } from "react";
import type { CategoryId, DeckFilters, GenreMode, PersonResult } from "../../shared/types";
import { DECK_MIN_TO_START } from "../../shared/types";
import { useRoom } from "../shared/RoomContext";
import CategoryPicker from "./CategoryPicker";
import JoinQR from "./JoinQR";
import PeopleTypeahead from "./PeopleTypeahead";

export default function Lobby() {
  const { state, setFilters, setGenres, setGenreMode, setSolo, startSession, leaveRoom } = useRoom();
  const isHost = state.you?.id === state.hostId;
  const [filters, setLocalFilters] = useState<DeckFilters>(state.filters);
  const [myCategories, setMyCategories] = useState<CategoryId[]>(state.myCategories);
  // Resyncs after externally-triggered resets (a host mode toggle clears
  // everyone's picks server-side); doesn't fight the optimistic update in
  // toggleGenre below since nothing else pushes state.myCategories changes.
  useEffect(() => setMyCategories(state.myCategories), [state.myCategories]);
  const [directorNames, setDirectorNames] = useState<Map<number, string>>(new Map());
  const [castNames, setCastNames] = useState<Map<number, string>>(new Map());
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string>();

  function update(next: Partial<DeckFilters>) {
    const merged = { ...filters, ...next };
    setLocalFilters(merged);
    setFilters(merged);
  }

  function toggleGenre(category: CategoryId) {
    const next = myCategories.includes(category) ? myCategories.filter((c) => c !== category) : [...myCategories, category];
    setMyCategories(next);
    setGenres(next);
  }

  async function handleStart() {
    setStarting(true);
    setStartError(undefined);
    const res = await startSession();
    setStarting(false);
    if (!res.ok) setStartError(res.message);
  }

  const connectedCount = state.players.filter((p) => p.connected).length || state.players.length;
  const soloRightNow = state.solo && state.players.length < 2;
  const canStart = state.players.length >= (state.solo ? 1 : 2) && state.deckSize >= DECK_MIN_TO_START && state.warm === "READY";

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-4 pb-8">
      <header className="sticky top-0 z-20 -mx-4 flex flex-col gap-3 bg-ink-950/95 px-4 pb-3 pt-6 ring-1 ring-white/5 backdrop-blur">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Binger</h1>
            <p className="text-sm text-white/50">{connectedCount} in the room</p>
          </div>
          <button
            onClick={leaveRoom}
            className="rounded-full bg-ink-800 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-white/70 ring-1 ring-white/10 transition active:scale-95"
          >
            Leave
          </button>
        </div>

        {isHost ? (
          <div className="flex flex-col gap-2">
            {startError && <p className="text-center text-sm text-red-400">{startError}</p>}
            <button
              disabled={!canStart || starting}
              onClick={handleStart}
              className="rounded-xl bg-white py-3.5 text-base font-semibold text-ink-950 transition active:scale-[0.98] disabled:opacity-40"
            >
              {starting ? "Starting…" : soloRightNow ? "Start Solo" : "Start Group"}
            </button>
          </div>
        ) : (
          <p className="text-center text-sm text-white/50">Waiting for the host to start…</p>
        )}
      </header>

      <div className="flex flex-col gap-6 pt-6">
        {isHost && (
          <section className="flex flex-col gap-3 rounded-2xl bg-ink-800 p-4">
            <label className="flex items-center justify-between text-sm font-medium">
              Just me tonight — solo picks
              <input
                type="checkbox"
                checked={state.solo}
                onChange={(e) => setSolo(e.target.checked)}
                className="h-5 w-5"
              />
            </label>
            {!state.solo && state.publicUrl && <JoinQR code={state.code!} publicUrl={state.publicUrl} />}
          </section>
        )}

        <PlayerList />

        <section className="flex flex-col gap-4 rounded-2xl bg-ink-800 p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Genres</h2>
            <WarmBadge warm={state.warm} progress={state.warmProgress} />
          </div>

          {isHost && <GenreModeToggle mode={state.genreMode} onChange={setGenreMode} />}

          <p className="text-xs text-white/50">
            {state.genreMode === "SHARED"
              ? "Only movies that overlap with everyone's picks make the cut."
              : "Everyone builds their own deck from their own picks."}
          </p>

          <CategoryPicker categories={state.categories} value={myCategories} onToggle={toggleGenre} />

          <div className="flex items-center justify-between text-sm text-white/60">
            <span>
              {state.genreProgress.picked}/{state.genreProgress.total} people picked
            </span>
            <span>
              {state.deckSize} movie{state.deckSize === 1 ? "" : "s"} in this deck
            </span>
          </div>
        </section>

        {isHost && (
          <section className="flex flex-col gap-4 rounded-2xl bg-ink-800 p-4">
            <h2 className="font-semibold">Filters</h2>

            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Max runtime</label>
              <span className="text-sm text-white/60">{filters.maxRuntime ? `${filters.maxRuntime} min` : "Any"}</span>
            </div>
            <input
              type="range"
              min={60}
              max={210}
              step={5}
              value={filters.maxRuntime ?? 210}
              onChange={(e) => update({ maxRuntime: Number(e.target.value) === 210 ? undefined : Number(e.target.value) })}
            />

            <label className="flex items-center justify-between text-sm font-medium">
              Unwatched only
              <input
                type="checkbox"
                checked={!!filters.unwatchedOnly}
                onChange={(e) => update({ unwatchedOnly: e.target.checked })}
                className="h-5 w-5"
              />
            </label>

            <div className="flex flex-col gap-4 border-t border-white/10 pt-4">
              <p className="text-sm font-medium">Narrow by cast or director</p>
              <PeopleTypeahead
                role="DIRECTOR"
                label="Director"
                selected={[...directorNames.entries()].map(([id, name]) => ({ id, name }))}
                onAdd={(p: PersonResult) => {
                  const next = new Map(directorNames).set(p.id, p.name);
                  setDirectorNames(next);
                  update({ directors: [...next.keys()] });
                }}
                onRemove={(id: number) => {
                  const next = new Map(directorNames);
                  next.delete(id);
                  setDirectorNames(next);
                  update({ directors: [...next.keys()] });
                }}
              />
              <PeopleTypeahead
                role="ACTOR"
                label="Cast"
                selected={[...castNames.entries()].map(([id, name]) => ({ id, name }))}
                onAdd={(p: PersonResult) => {
                  const next = new Map(castNames).set(p.id, p.name);
                  setCastNames(next);
                  update({ cast: [...next.keys()] });
                }}
                onRemove={(id: number) => {
                  const next = new Map(castNames);
                  next.delete(id);
                  setCastNames(next);
                  update({ cast: [...next.keys()] });
                }}
              />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function GenreModeToggle({ mode, onChange }: { mode: GenreMode; onChange: (mode: GenreMode) => void }) {
  return (
    <div className="flex rounded-full bg-ink-700 p-1 text-xs font-medium">
      <button
        className={`flex-1 rounded-full py-1.5 transition ${mode === "SHARED" ? "bg-white text-ink-950" : "text-white/70"}`}
        onClick={() => onChange("SHARED")}
      >
        Shared list
      </button>
      <button
        className={`flex-1 rounded-full py-1.5 transition ${mode === "PERSONAL" ? "bg-white text-ink-950" : "text-white/70"}`}
        onClick={() => onChange("PERSONAL")}
      >
        Everyone's own
      </button>
    </div>
  );
}

function WarmBadge({ warm, progress }: { warm: string; progress: { done: number; total: number } }) {
  if (warm === "READY") return <span className="text-xs text-emerald-400">Ready</span>;
  if (warm === "WARMING")
    return (
      <span className="text-xs text-amber-400">
        Warming {progress.total ? `${progress.done}/${progress.total}` : "…"}
      </span>
    );
  return <span className="text-xs text-white/40">Cold</span>;
}

function PlayerList() {
  const { state } = useRoom();
  return (
    <div className="flex flex-wrap gap-2">
      {state.players.map((p) => (
        <span
          key={p.id}
          className={`rounded-full px-3 py-1 text-sm ring-1 ${
            p.connected ? "bg-ink-800 ring-white/10" : "bg-ink-800/50 text-white/40 ring-white/5"
          }`}
        >
          {p.isHost ? "👑 " : ""}
          {p.name}
        </span>
      ))}
    </div>
  );
}
