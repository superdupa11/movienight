import { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORY_LABELS } from "../../shared/types";
import { useRoom } from "../shared/RoomContext";
import MatchCard from "./MatchCard";
import PopcornLayer from "./PopcornLayer";
import { makeSeeds } from "./popcorn";
import { useCeremonyClock } from "./useCeremonyClock";

const prefersReducedMotion =
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const INTRO_DURATION = 2;
const CEREMONY_DURATION = 2.9;
const TOTAL_DURATION = INTRO_DURATION + CEREMONY_DURATION;
const POPCORN_COUNT = 46;
const BURST_POWER = 1;
const SHOW_FLASH = true;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
const easeIn = (x: number) => Math.pow(clamp01(x), 2.4);

const CAST_LABEL = {
  LAUNCHING: "Opening…",
  WAITING_FOR_SIGNIN: "Check the TV…",
  PLAYING: "Playing on TV",
  ERROR: "Open on TV",
} as const;

export default function Reveal() {
  const { state, resetSession, leaveRoom, openOnTv, selectDevice } = useRoom();
  const result = state.result;
  const isHost = state.you?.id === state.hostId;
  const castStatus = state.castStatus;
  const castBusy = castStatus?.state === "LAUNCHING" || castStatus?.state === "WAITING_FOR_SIGNIN";
  const showCastButton = isHost && state.tvCastEnabled;
  const pickDevices = state.pickDevices;
  const picking = showCastButton && !!pickDevices && pickDevices.length > 0;

  const containerRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState(() => ({
    width: typeof window !== "undefined" ? window.innerWidth : 402,
    height: typeof window !== "undefined" ? window.innerHeight : 874,
  }));

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setStage({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Ceremony plays once per result: sessionStorage-gated inside the clock
  // hook, keyed on movie id (the protocol has no round id; a rare rematch on
  // the same movie replaying the ceremony once more is an acceptable trade-off).
  const resultKey = result?.movie.id;
  const { t, skip } = useCeremonyClock(resultKey, TOTAL_DURATION, prefersReducedMotion);

  const seeds = useMemo(
    () => makeSeeds(POPCORN_COUNT, BURST_POWER, stage),
    [stage.width, stage.height],
  );

  if (!result) return null;
  const { movie } = result;
  const deckSize = state.deck?.length ?? state.deckSize;

  const metaParts = [
    movie.year ? String(movie.year) : null,
    movie.runtime ? `${movie.runtime} min` : null,
    movie.contentRating ?? null,
    movie.categories[0] ? CATEGORY_LABELS[movie.categories[0]] : null,
  ].filter((p): p is string => !!p);

  const noteText =
    result.note ??
    (result.via === "match" && result.idx != null
      ? `Unanimous on card ${result.idx + 1} of ${deckSize}. Nobody had to explain themselves.`
      : null);

  const titleCardEyebrow =
    result.via === "match"
      ? `UNANIMOUS · ${(result.idx ?? 0) + 1} OF ${deckSize}`
      : `RUNOFF WINNER · ${result.votes} VOTE${result.votes === 1 ? "" : "S"}`;

  // tb = burst-local clock (0 once the intro title card finishes holding).
  // Critical: the popcorn array and the bloom flash are gated on tb, not t —
  // gating on t would park every kernel at its origin and flash the bloom at
  // full strength on top of the title card during the intro.
  const tb = Math.max(0, t - INTRO_DURATION);
  const dur = CEREMONY_DURATION;

  const inFade = clamp01(t / Math.min(0.5, INTRO_DURATION * 0.3));
  const outFade = clamp01((t - (INTRO_DURATION - 0.4)) / 0.4);
  const introOpacity = easeOut(inFade) * (1 - easeIn(outFade));
  const introScale = 0.9 + 0.1 * easeOut(inFade) + 0.16 * easeIn(outFade);
  const introEyebrowOpacity = easeOut(clamp01((t - 0.25) / 0.5));

  const artIn = clamp01((tb - dur * 0.06) / (dur * 0.66));
  const artOpacity = easeOut(artIn);
  const artScale = 1.1 - 0.1 * easeOut(artIn);
  const scrimOpacity = 0.25 + 0.75 * easeOut(artIn);

  const flashOpacity = SHOW_FLASH && tb > 0 ? Math.max(0, 1 - tb / 0.42) * (1 - easeIn(tb / 0.42) * 0.2) : 0;

  const fadeStart = dur - 0.85;
  const fadeEnd = dur - 0.25;
  const kernelFade = 1 - clamp01((tb - fadeStart) / (fadeEnd - fadeStart));

  const revealIn = clamp01((tb - dur * 0.33) / (dur * 0.34));
  const revealOpacity = easeOut(revealIn);
  const revealY = 18 * (1 - easeOut(revealIn));

  return (
    <div
      ref={containerRef}
      onClick={skip}
      className="relative flex h-screen flex-col justify-end overflow-hidden bg-ink-950"
    >
      <div
        className="absolute inset-0"
        style={{ opacity: artOpacity, transform: `scale(${artScale})`, transformOrigin: "50% 42%" }}
      >
        {movie.backdropUrl ? (
          <img src={movie.backdropUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <>
            <div
              className="absolute inset-0"
              style={{ background: "linear-gradient(148deg, #3b6fa8 0 34%, #e0a34a 34% 52%, #8c3f52 52% 68%, #0d1b2a 68%)" }}
            />
            <div
              className="absolute inset-0"
              style={{
                background: "radial-gradient(120% 80% at 62% 22%, rgba(224,163,74,.5), transparent 62%)",
                filter: "blur(28px)",
              }}
            />
            <div
              className="absolute inset-0"
              style={{ background: "radial-gradient(90% 70% at 20% 70%, rgba(13,27,42,.9), transparent 70%)" }}
            />
          </>
        )}
      </div>

      <div
        className="absolute inset-0"
        style={{ background: "linear-gradient(to top, #000 12%, rgba(0,0,0,.78) 46%, rgba(0,0,0,.15))", opacity: scrimOpacity }}
      />

      {SHOW_FLASH && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: "radial-gradient(46% 30% at 50% 46%, rgba(255,244,214,.9), rgba(224,163,74,.35) 45%, transparent 72%)",
            opacity: flashOpacity,
          }}
        />
      )}

      <div
        className="relative px-[26px] pb-[34px]"
        style={{ opacity: revealOpacity, transform: `translateY(${revealY}px)` }}
      >
        <p className="mb-3.5 font-mono text-[10px] font-medium tracking-[.3em]" style={{ color: "#e0a34a" }}>
          {result.via === "match" ? "IT'S A MATCH" : `RUNOFF WINNER · ${result.votes} VOTE${result.votes === 1 ? "" : "S"}`}
        </p>

        <h1 className="font-display text-[66px] uppercase leading-[.86] tracking-[.01em]">{movie.title}</h1>

        {metaParts.length > 0 && <p className="mt-3 text-sm text-white/60">{metaParts.join(" · ")}</p>}

        {noteText && (
          <p className="mt-4 text-sm leading-[1.55] text-white/50" style={{ maxWidth: 300, textWrap: "pretty" }}>
            {noteText}
          </p>
        )}

        {picking && (
          <div className="mt-[26px] flex flex-col gap-2">
            <p className="text-center text-[12px] text-white/50">Multiple TVs are open — pick one</p>
            {pickDevices!.map((d) => (
              <button
                key={d.id}
                onClick={() => selectDevice(d.id)}
                className="rounded-[14px] py-[15px] text-center text-sm font-bold text-[#08080b] transition active:scale-[0.98]"
                style={{ background: "#fff" }}
              >
                {d.name}
              </button>
            ))}
          </div>
        )}

        <div className={picking ? "mt-2.5 flex gap-2.5" : "mt-[26px] flex gap-2.5"}>
          {picking ? null : showCastButton ? (
            <button
              onClick={openOnTv}
              disabled={castBusy}
              className="flex-1 rounded-[14px] py-[15px] text-center text-sm font-bold text-[#08080b] disabled:opacity-70"
              style={{ background: "#fff" }}
            >
              {castStatus ? CAST_LABEL[castStatus.state] : "Open on TV"}
            </button>
          ) : (
            <a
              href={result.plexUrl}
              target="_blank"
              rel="noreferrer"
              className="flex-1 rounded-[14px] py-[15px] text-center text-sm font-bold text-[#08080b]"
              style={{ background: "#fff" }}
            >
              Open in Plex
            </a>
          )}
          {isHost && (
            <button
              onClick={resetSession}
              className="flex-1 rounded-[14px] border border-white/[.16] py-[15px] text-center text-sm font-medium text-white/80"
            >
              Start over
            </button>
          )}
        </div>
        {showCastButton && !picking && castStatus?.state === "ERROR" && (
          <p className="mt-2.5 text-center text-[12px] text-no">{castStatus.message ?? "Couldn't open Plex on the TV."}</p>
        )}
        {showCastButton && !picking && (
          <a
            href={result.plexUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2.5 block text-center text-[12px] text-white/40 underline decoration-white/20 underline-offset-2"
          >
            Or open in Plex on this device
          </a>
        )}
        {!isHost && (
          <p className="mt-3 text-center text-[13px] text-white/50">Waiting for the host to start a new round…</p>
        )}
        <button
          onClick={leaveRoom}
          className="mt-3 w-full text-center text-[13px] text-white/40 transition hover:text-white/60"
        >
          Leave room
        </button>
      </div>

      <MatchCard eyebrow={titleCardEyebrow} opacity={introOpacity} scale={introScale} eyebrowOpacity={introEyebrowOpacity} />

      <PopcornLayer seeds={seeds} t={tb} stage={stage} fade={kernelFade} />
    </div>
  );
}
