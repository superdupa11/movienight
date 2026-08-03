import { useState } from "react";
import type { CategoryId, DeckFilters, PersonResult } from "../../shared/types";
import { DECK_LIMIT_MAX, DECK_MIN_TO_START } from "../../shared/types";
import { useRoom } from "../shared/RoomContext";
import CategoryPicker from "./CategoryPicker";
import JoinQR from "./JoinQR";
import PeopleTypeahead from "./PeopleTypeahead";

export default function Lobby() {
  const { state, setFilters, startSession, leaveRoom } = useRoom();
  const isHost = state.you?.id === state.hostId;
  const [filters, setLocalFilters] = useState<DeckFilters>(state.filters);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [directorNames, setDirectorNames] = useState<Map<number, string>>(new Map());
  const [castNames, setCastNames] = useState<Map<number, string>>(new Map());
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string>();

  function update(next: Partial<DeckFilters>) {
    const merged = { ...filters, ...next };
    setLocalFilters(merged);
    setFilters(merged);
  }

  async function handleStart() {
    setStarting(true);
    setStartError(undefined);
    const res = await startSession();
    setStarting(false);
    if (!res.ok) setStartError(res.message);
  }

  const allCategoryCount = state.categories.reduce((max, c) => Math.max(max, c.count), state.deckSize);
  const connectedCount = state.players.filter((p) => p.connected).length || state.players.length;
  const canStart = state.players.length >= 2 && state.deckSize >= DECK_MIN_TO_START && state.warm === "READY";

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Movie Night</h1>
          <p className="text-sm text-white/50">{connectedCount} in the room</p>
        </div>
        <button onClick={leaveRoom} className="text-sm text-white/50 underline">
          Leave
        </button>
      </header>

      {isHost && state.publicUrl && <JoinQR code={state.code!} publicUrl={state.publicUrl} />}

      <PlayerList />

      <section className="flex flex-col gap-4 rounded-2xl bg-ink-800 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Category</h2>
          <WarmBadge warm={state.warm} progress={state.warmProgress} />
        </div>
        <CategoryPicker
          categories={state.categories}
          value={filters.category}
          editable={isHost}
          allCount={allCategoryCount}
          onChange={(category: CategoryId | "ALL") => update({ category })}
        />
        <p className="text-sm text-white/60">
          {state.deckSize} movie{state.deckSize === 1 ? "" : "s"} in this deck
        </p>
      </section>

      {isHost && (
        <section className="flex flex-col gap-4 rounded-2xl bg-ink-800 p-4">
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

          <label className="flex items-center justify-between text-sm font-medium">
            Deck size
            <input
              type="number"
              min={DECK_MIN_TO_START}
              max={DECK_LIMIT_MAX}
              value={filters.limit}
              onChange={(e) => update({ limit: Number(e.target.value) })}
              className="w-20 rounded-lg bg-ink-700 px-2 py-1 text-right"
            />
          </label>

          <button className="text-left text-sm font-medium text-white/70 underline" onClick={() => setPeopleOpen((v) => !v)}>
            {peopleOpen ? "Hide" : "Narrow by cast or director"}
          </button>

          {peopleOpen && (
            <div className="flex flex-col gap-4">
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
          )}
        </section>
      )}

      {isHost ? (
        <div className="mt-auto flex flex-col gap-2">
          {startError && <p className="text-center text-sm text-red-400">{startError}</p>}
          <button
            disabled={!canStart || starting}
            onClick={handleStart}
            className="rounded-xl bg-white py-4 text-lg font-semibold text-ink-950 transition active:scale-[0.98] disabled:opacity-40"
          >
            {starting ? "Starting…" : "Start voting"}
          </button>
        </div>
      ) : (
        <p className="mt-auto text-center text-white/50">Waiting for the host to start…</p>
      )}
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
