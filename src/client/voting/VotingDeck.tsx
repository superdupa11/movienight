import { useEffect, useMemo, useRef, useState } from "react";
import { useRoom } from "../shared/RoomContext";
import Card from "./Card";

const SWIPE_THRESHOLD = 110;
const PRELOAD_AHEAD = 3;

export default function VotingDeck() {
  const { state, castVote, undoVote, cardFlip } = useRoom();
  const deck = state.deck ?? [];
  const you = state.you!;

  const [index, setIndex] = useState(() => state.progress[you.id]?.cursor ?? 0);
  const [flipped, setFlipped] = useState(false);
  const [dragX, setDragX] = useState(0);
  const dragging = useRef(false);
  const startX = useRef(0);
  const lastVoted = useRef<number[]>([]);

  useEffect(() => {
    const preloaded = new Set<string>();
    for (let i = index; i < Math.min(index + PRELOAD_AHEAD, deck.length); i++) {
      const m = deck[i];
      if (!m || preloaded.has(m.id)) continue;
      preloaded.add(m.id);
      const img = new Image();
      img.src = m.posterUrl;
    }
  }, [index, deck]);

  const otherPlayers = useMemo(() => state.players.filter((p) => p.id !== you.id), [state.players, you.id]);
  const total = deck.length;
  const current = deck[index];

  function vote(liked: boolean) {
    if (index >= total) return;
    castVote(index, liked);
    lastVoted.current.push(index);
    setFlipped(false);
    setDragX(0);
    setIndex((i) => i + 1);
  }

  function undo() {
    const prev = lastVoted.current.pop();
    if (prev == null) return;
    undoVote(prev);
    setFlipped(false);
    setDragX(0);
    setIndex(prev);
  }

  function onPointerDown(e: React.PointerEvent) {
    dragging.current = true;
    startX.current = e.clientX;
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    setDragX(e.clientX - startX.current);
  }
  function onPointerUp() {
    if (!dragging.current) return;
    dragging.current = false;
    if (dragX > SWIPE_THRESHOLD) vote(true);
    else if (dragX < -SWIPE_THRESHOLD) vote(false);
    else setDragX(0);
  }

  if (index >= total) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white" />
        <p className="text-lg text-white/70">Waiting on the rest of the room…</p>
        <div className="flex flex-wrap justify-center gap-2">
          {otherPlayers.map((p) => {
            const prog = state.progress[p.id];
            const done = prog && prog.total > 0 && prog.cursor >= prog.total;
            return (
              <span key={p.id} className={`rounded-full px-3 py-1 text-xs ${done ? "bg-emerald-500/20 text-emerald-300" : "bg-ink-800 text-white/60"}`}>
                {p.name} {prog ? `${prog.cursor}/${prog.total}` : ""}
              </span>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col gap-4 px-4 py-6">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
        <div className="h-full bg-white transition-all" style={{ width: `${(index / Math.max(total, 1)) * 100}%` }} />
      </div>

      <div
        className="relative flex-1 touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        style={{ transform: `translateX(${dragX}px) rotate(${dragX / 20}deg)`, transition: dragging.current ? "none" : "transform 0.2s" }}
      >
        {current && (
          <Card
            movie={current}
            flipped={flipped}
            onFlip={() => {
              setFlipped((f) => !f);
              cardFlip(index);
            }}
          />
        )}
        {dragX > 30 && <SwipeBadge label="YES" className="left-4 border-emerald-400 text-emerald-400" />}
        {dragX < -30 && <SwipeBadge label="NO" className="right-4 border-red-400 text-red-400" />}
      </div>

      <div className="flex items-center justify-center gap-6">
        <button
          onClick={undo}
          disabled={lastVoted.current.length === 0}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-ink-800 text-xl disabled:opacity-30"
          aria-label="Undo"
        >
          ↩
        </button>
        <button
          onClick={() => vote(false)}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-ink-800 text-3xl text-red-400 ring-1 ring-red-400/30 active:scale-95"
          aria-label="Pass"
        >
          ✕
        </button>
        <button
          onClick={() => vote(true)}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-ink-800 text-3xl text-emerald-400 ring-1 ring-emerald-400/30 active:scale-95"
          aria-label="Like"
        >
          ♥
        </button>
      </div>
    </div>
  );
}

function SwipeBadge({ label, className }: { label: string; className: string }) {
  return (
    <div className={`absolute top-8 rounded-lg border-4 px-3 py-1 text-2xl font-black uppercase tracking-wider ${className}`}>
      {label}
    </div>
  );
}
