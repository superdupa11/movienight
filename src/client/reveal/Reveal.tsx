import { useEffect, useState } from "react";
import { CATEGORY_LABELS } from "../../shared/types";
import { useRoom } from "../shared/RoomContext";

const prefersReducedMotion =
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function Reveal() {
  const { state, resetSession } = useRoom();
  const [mounted, setMounted] = useState(false);
  const result = state.result;
  const isHost = state.you?.id === state.hostId;

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

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

  return (
    <div
      className="relative flex h-screen flex-col justify-end overflow-hidden"
      style={{ opacity: mounted ? 1 : 0, transition: `opacity ${prefersReducedMotion ? ".2s" : "1.2s"} ease` }}
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
      <div
        className="absolute inset-0"
        style={{ background: "linear-gradient(to top, #000 12%, rgba(0,0,0,.78) 46%, rgba(0,0,0,.15))" }}
      />

      <div
        className="relative px-[26px] pb-[34px]"
        style={
          prefersReducedMotion
            ? undefined
            : {
                opacity: mounted ? 1 : 0,
                transform: mounted ? "translateY(0)" : "translateY(18px)",
                transition: "opacity .9s ease .25s, transform .9s ease .25s",
              }
        }
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

        <div className="mt-[26px] flex gap-2.5">
          <a
            href={result.plexUrl}
            target="_blank"
            rel="noreferrer"
            className="flex-1 rounded-[14px] py-[15px] text-center text-sm font-bold text-[#08080b]"
            style={{ background: "#fff" }}
          >
            Open in Plex
          </a>
          {isHost && (
            <button
              onClick={resetSession}
              className="flex-1 rounded-[14px] border border-white/[.16] py-[15px] text-center text-sm font-medium text-white/80"
            >
              Start over
            </button>
          )}
        </div>
        {!isHost && (
          <p className="mt-3 text-center text-[13px] text-white/50">Waiting for the host to start a new round…</p>
        )}
      </div>
    </div>
  );
}
