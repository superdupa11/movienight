import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { CategoryId, DeckFilters, GenreMode, Player, PersonResult, WarmState } from "../../shared/types";
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
  const [refineOpen, setRefineOpen] = useState(false);

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
  const hostPlayer = state.players.find((p) => p.isHost);
  const modeCopy =
    state.genreMode === "SHARED"
      ? "Only movies that overlap with everyone's picks make the cut."
      : "Everyone builds their own deck from their own picks.";

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col bg-ink-950">
      <header className="flex items-start justify-between px-[18px] pb-[18px] pt-[22px]">
        <div>
          <h1 className="text-[23px] font-bold tracking-[-0.015em] text-white">binger</h1>
          <p className="mt-[3px] text-[13px] text-white/45">
            {connectedCount} in the room
            {!isHost && hostPlayer ? ` · 👑 ${hostPlayer.name} is hosting` : ""}
          </p>
        </div>
        <button onClick={leaveRoom} className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/45">
          Leave
        </button>
      </header>

      <div className="flex flex-col gap-6 px-[18px] pb-[24px]">
        {isHost && (
          <div className="flex flex-col gap-3 rounded-xl bg-ink-900 p-4 ring-1 ring-inset ring-white/[0.06]">
            <label className="flex items-center justify-between text-[13.5px] font-medium text-white/80">
              Just me tonight — solo picks
              <Switch checked={state.solo} onChange={setSolo} />
            </label>
            {!state.solo && state.publicUrl && <JoinQR code={state.code!} publicUrl={state.publicUrl} />}
          </div>
        )}

        {!state.solo && <PlayerChips players={state.players} />}

        <section className="flex flex-col gap-[14px]">
          <div className="flex flex-col gap-1">
            <div className="flex items-end justify-between gap-3">
              <h2 className="text-[17px] font-semibold text-white">{isHost ? "Genres" : "Your picks"}</h2>
              {isHost ? (
                <WarmBadge warm={state.warm} progress={state.warmProgress} />
              ) : (
                <StatusPill picked={myCategories.length > 0} />
              )}
            </div>
            <p className="text-[12.5px] leading-[1.45] text-white/45">{modeCopy}</p>
          </div>

          {isHost && <GenreModeTabs mode={state.genreMode} onChange={setGenreMode} />}
          {!isHost && <HostSetStrip filters={state.filters} />}

          <div>
            <CategoryPicker categories={state.categories} value={myCategories} onToggle={toggleGenre} />
            <p className="ml-[2px] mt-[6px] font-mono text-[9.5px] tracking-[0.12em] text-white/[0.28]">
              Bar length = share of the largest eligible genre, after filters
            </p>
          </div>
        </section>

        {isHost && (
          <section className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setRefineOpen((v) => !v)}
              className="flex items-center justify-between rounded-[10px] bg-ink-900 px-[14px] py-[13px] text-left text-[13.5px] font-medium text-white/80"
            >
              <span>Refine · runtime, watched, people</span>
              <span className="font-mono text-[#e0a34a]">{refineOpen ? "−" : "+"}</span>
            </button>

            {refineOpen && (
              <div className="flex flex-col gap-[18px] rounded-xl bg-ink-900 p-4">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[13.5px] font-medium text-white/80">Max runtime</span>
                    <span className="font-mono text-[12.5px] text-[#e0a34a]">
                      {filters.maxRuntime ? `${filters.maxRuntime} min` : "Any"}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={60}
                    max={210}
                    step={5}
                    value={filters.maxRuntime ?? 210}
                    onChange={(e) => update({ maxRuntime: Number(e.target.value) === 210 ? undefined : Number(e.target.value) })}
                    className="w-full accent-[#e0a34a]"
                  />
                </div>

                <label className="flex items-center justify-between">
                  <span className="text-[13.5px] font-medium text-white/80">Unwatched only</span>
                  <Switch checked={!!filters.unwatchedOnly} onChange={(v) => update({ unwatchedOnly: v })} />
                </label>

                <div className="flex gap-2.5">
                  <PeopleTypeahead
                    role="DIRECTOR"
                    placeholder="Director…"
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
                    placeholder="Cast…"
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
              </div>
            )}
          </section>
        )}
      </div>

      <div className="sticky bottom-0 border-t border-white/10 bg-[rgba(8,8,11,0.96)] px-[18px] pb-[18px] pt-3 backdrop-blur">
        {isHost ? (
          <>
            {startError && <p className="mb-2 text-center text-sm text-red-400">{startError}</p>}
            <div className="flex items-center gap-[14px]">
              <div className="flex-none">
                <div className="font-display text-2xl leading-none text-[#e0a34a]">{state.deckSize}</div>
                <div className="mt-1 whitespace-nowrap font-mono text-[8.5px] tracking-[0.16em] text-white/35">
                  IN DECK · {state.genreProgress.picked}/{state.genreProgress.total}
                </div>
              </div>
              <button
                disabled={!canStart || starting}
                onClick={handleStart}
                className="flex-1 rounded-xl bg-[#e0a34a] py-[14px] text-[15px] font-semibold text-ink-950 transition active:scale-[0.98] disabled:opacity-40"
              >
                {starting ? "Starting…" : soloRightNow ? "Start Solo" : "Start Group"}
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-[13.5px]">
              <span className="text-white/60">
                {state.genreProgress.picked}/{state.genreProgress.total} people picked
              </span>
              <span className="text-white">{state.deckSize} in this deck</span>
            </div>
            <p className="text-center text-[13.5px] text-white/55">Waiting for the host to start…</p>
          </div>
        )}
      </div>
    </div>
  );
}

function GenreModeTabs({ mode, onChange }: { mode: GenreMode; onChange: (mode: GenreMode) => void }) {
  return (
    <div className="flex gap-[18px] border-b border-white/10">
      <TabButton active={mode === "SHARED"} onClick={() => onChange("SHARED")}>
        Shared list
      </TabButton>
      <TabButton active={mode === "PERSONAL"} onClick={() => onChange("PERSONAL")}>
        Everyone's own
      </TabButton>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={[
        "pb-[9px] text-[13px] font-medium transition",
        active ? "text-white shadow-[inset_0_-2px_0_#e0a34a]" : "text-white/40",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function WarmBadge({ warm, progress }: { warm: WarmState; progress: { done: number; total: number } }) {
  const color = warm === "READY" ? "text-[#34c77b]" : warm === "WARMING" ? "text-[#e0a34a]" : "text-white/40";
  const label =
    warm === "READY" ? "READY" : warm === "WARMING" ? `Warming ${progress.total ? `${progress.done}/${progress.total}` : "…"}` : "COLD";
  return <span className={`flex-none pb-[3px] font-mono text-[10px] font-medium tracking-[0.14em] ${color}`}>{label}</span>;
}

function StatusPill({ picked }: { picked: boolean }) {
  return (
    <span
      className={[
        "flex-none whitespace-nowrap rounded-full px-3 py-[5px] font-mono text-[9.5px] font-medium tracking-[0.16em]",
        picked ? "bg-[rgba(52,199,123,0.14)] text-[#34c77b]" : "bg-white/[0.07] text-white/45",
      ].join(" ")}
    >
      {picked ? "LOCKED IN" : "NOT PICKED"}
    </span>
  );
}

function HostSetStrip({ filters }: { filters: DeckFilters }) {
  const watched = filters.unwatchedOnly ? "Unwatched only" : "All titles";
  const runtime = filters.maxRuntime ? `≤ ${filters.maxRuntime} min` : "Any runtime";
  return (
    <div className="flex items-center gap-[10px] rounded-[10px] bg-ink-900 px-[13px] py-[11px] ring-1 ring-inset ring-white/[0.06]">
      <span className="flex-none font-mono text-[9px] font-medium tracking-[0.18em] text-white/35">HOST SET</span>
      <span className="text-[12.5px] text-white/70">
        {watched} · {runtime}
      </span>
    </div>
  );
}

function PlayerChips({ players }: { players: Player[] }) {
  if (players.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {players.map((p) => (
        <span
          key={p.id}
          className={[
            "rounded-full px-3 py-[6px] text-[12.5px] ring-1 ring-inset",
            p.connected ? "bg-ink-800 text-white ring-white/10" : "bg-ink-800/50 text-white/40 ring-white/5",
          ].join(" ")}
        >
          {p.isHost ? "👑 " : ""}
          {p.name}
        </span>
      ))}
    </div>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={[
        "relative h-[26px] w-[46px] flex-none rounded-full ring-1 ring-inset ring-white/10 transition-colors duration-[180ms]",
        checked ? "bg-[#e0a34a]" : "bg-ink-700",
      ].join(" ")}
    >
      <span
        className={[
          "absolute top-[3px] h-5 w-5 rounded-full transition-[left] duration-[180ms]",
          checked ? "left-[23px] bg-ink-950" : "left-[3px] bg-white/55",
        ].join(" ")}
      />
    </button>
  );
}
