import { useEffect, useRef, useState } from "react";
import { useRoom } from "../shared/RoomContext";
import Card from "./Card";

const SWIPE_THRESHOLD = 90;
const PRELOAD_AHEAD = 3;
const FLY_OUT_PX = 700;
const EXIT_MS = 230;
// Fixed fallback — per-poster dominant-color sampling would need an ingest-time
// (server) change, out of scope for this presentation-only pass.
const ACCENT_FALLBACK = "#3b6fa8";

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export default function VotingDeck() {
  const { state, castVote, undoVote, cardFlip } = useRoom();
  const deck = state.deck ?? [];
  const you = state.you!;

  const [index, setIndex] = useState(() => state.progress[you.id]?.cursor ?? 0);
  const [flipped, setFlipped] = useState(false);
  const [dragX, setDragX] = useState(0);
  const dragging = useRef(false);
  const exiting = useRef(false);
  const startX = useRef(0);
  const lastVoted = useRef<string[]>([]);

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

  const total = deck.length;
  const current = deck[index];
  const accent = ACCENT_FALLBACK;

  function vote(liked: boolean) {
    if (index >= total || exiting.current || !current) return;
    castVote(current.id, liked);
    lastVoted.current.push(current.id);
    dragging.current = false;
    exiting.current = true;
    setDragX(liked ? FLY_OUT_PX : -FLY_OUT_PX);
    setTimeout(() => {
      exiting.current = false;
      setFlipped(false);
      setDragX(0);
      setIndex((i) => i + 1);
    }, EXIT_MS);
  }

  function undo() {
    const prevMovieId = lastVoted.current.pop();
    if (prevMovieId == null) return;
    undoVote(prevMovieId);
    setFlipped(false);
    setDragX(0);
    setIndex((i) => Math.max(0, i - 1));
  }

  function onPointerDown(e: React.PointerEvent) {
    if (exiting.current) return;
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
      <div className="relative flex h-screen flex-col items-center justify-center gap-4 overflow-hidden px-6 text-center">
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: `radial-gradient(110% 70% at 50% 92%, ${accent}66, transparent 72%)` }}
        />
        <div className="relative h-10 w-10 animate-spin rounded-full border-2 border-white/15 border-t-white/70" />
        {/* Invisible group: never reveal other players' progress here (CLAUDE.md invariant 4). */}
        <p className="relative font-mono text-[11px] uppercase tracking-[.2em] text-white/40">
          Waiting on the rest of the room…
        </p>
      </div>
    );
  }

  const yesOpacity = clamp01(dragX / 95);
  const noOpacity = clamp01(-dragX / 95);

  return (
    <div className="relative flex h-screen flex-col overflow-hidden px-4 pb-6 pt-3.5">
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: `radial-gradient(110% 70% at 50% 92%, ${accent}66, transparent 72%)` }}
      />

      <div className="relative mb-3.5 flex items-center justify-between font-mono text-[11px] font-medium tracking-[.16em] text-white/40">
        <span>
          MOVIE NIGHT · ROOM {state.code}
        </span>
        <span>
          <span className="text-white/40">{String(index + 1).padStart(2, "0")}</span>
          <span className="opacity-45">/{String(total).padStart(2, "0")}</span>
        </span>
      </div>

      <div className="relative mb-4 flex gap-[3px]">
        {deck.map((_, i) => (
          <div
            key={i}
            className="h-[2px] flex-1 rounded-[2px]"
            style={{
              background: i < index ? "rgba(255,255,255,.85)" : i === index ? accent : "rgba(255,255,255,.14)",
            }}
          />
        ))}
      </div>

      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-x-3.5 bottom-0 top-[22px] rounded-[26px] bg-ink-800 opacity-50" />
        <div className="absolute inset-x-[7px] bottom-0 top-[11px] rounded-[26px] bg-ink-700 opacity-75" />

        <div
          className="absolute inset-0 touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          style={{
            transform: `translateX(${dragX}px) rotate(${dragX / 22}deg)`,
            transition: dragging.current ? "none" : "transform .23s cubic-bezier(.2,.8,.3,1)",
            cursor: dragging.current ? "grabbing" : "grab",
          }}
        >
          {current && (
            <Card
              movie={current}
              flipped={flipped}
              onFlip={() => {
                setFlipped((f) => !f);
                cardFlip(current.id);
              }}
            />
          )}

          <div
            className="pointer-events-none absolute inset-0 rounded-[26px]"
            style={{
              background: "linear-gradient(to left, rgba(52,199,123,.55), transparent 55%)",
              opacity: yesOpacity,
            }}
          />
          <div
            className="pointer-events-none absolute inset-0 rounded-[26px]"
            style={{
              background: "linear-gradient(to right, rgba(226,72,63,.5), transparent 55%)",
              opacity: noOpacity,
            }}
          />
          <div
            className="pointer-events-none absolute top-1/2 font-display text-[44px] tracking-[.06em] text-yes"
            style={{ right: 26, transform: "translateY(-50%)", opacity: yesOpacity }}
          >
            YES
          </div>
          <div
            className="pointer-events-none absolute top-1/2 font-display text-[44px] tracking-[.06em] text-no"
            style={{ left: 26, transform: "translateY(-50%)", opacity: noOpacity }}
          >
            NO
          </div>
        </div>
      </div>

      <div className="relative mt-5 flex items-center justify-center gap-[26px]">
        <button
          onClick={() => vote(false)}
          className="flex h-[58px] w-[58px] items-center justify-center rounded-full text-no transition hover:bg-[rgba(226,72,63,.12)] active:bg-[rgba(226,72,63,.12)] active:scale-95"
          style={{ border: "1px solid rgba(226,72,63,.35)" }}
          aria-label="Pass"
        >
          <PassIcon className="h-[22px] w-[22px]" />
        </button>
        <button
          onClick={undo}
          disabled={lastVoted.current.length === 0}
          className="flex h-[42px] w-[42px] items-center justify-center rounded-full text-[15px] text-white/50 transition hover:bg-white/[.12] active:bg-white/[.12] disabled:opacity-30 disabled:hover:bg-transparent"
          style={{ border: "1px solid rgba(255,255,255,.12)" }}
          aria-label="Undo"
        >
          ↩
        </button>
        <button
          onClick={() => vote(true)}
          className="flex h-[58px] w-[58px] items-center justify-center rounded-full text-yes transition hover:bg-[rgba(52,199,123,.12)] active:bg-[rgba(52,199,123,.12)] active:scale-95"
          style={{ border: "1px solid rgba(52,199,123,.35)" }}
          aria-label="Like"
        >
          <LikeIcon className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

// Bold, rounded-cap glyphs matching the app icon's X/heart style — swapped in
// for plain "✕"/"♥" text characters, which render inconsistently across
// platform fonts.
function PassIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.25} strokeLinecap="round" className={className}>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

function LikeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
    </svg>
  );
}
