import { useState } from "react";
import type { Movie } from "../../shared/types";
import { CATEGORY_LABELS } from "../../shared/types";

const HINT_SEEN_KEY = "movienight:hint-seen";

export default function Card({ movie, flipped, onFlip }: { movie: Movie; flipped: boolean; onFlip: () => void }) {
  const [hintDismissed, setHintDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(HINT_SEEN_KEY) === "1";
    } catch {
      return false;
    }
  });

  function handleClick() {
    if (!hintDismissed) {
      try {
        sessionStorage.setItem(HINT_SEEN_KEY, "1");
      } catch {
        // sessionStorage unavailable (e.g. private mode) — hint just won't persist across cards
      }
      setHintDismissed(true);
    }
    onFlip();
  }

  return (
    <div
      onClick={handleClick}
      className="relative aspect-poster w-full select-none rounded-[26px] bg-ink-900"
      style={{ perspective: "1200px", boxShadow: "0 30px 60px -20px rgba(0,0,0,.9)" }}
    >
      <div
        className="absolute inset-0 rounded-[26px]"
        style={{
          transformStyle: "preserve-3d",
          transition: "transform .45s cubic-bezier(.2,.8,.3,1)",
          transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
        }}
      >
        <div className="absolute inset-0 overflow-hidden rounded-[26px]" style={{ backfaceVisibility: "hidden" }}>
          <CardFront movie={movie} showHint={!hintDismissed} />
        </div>
        <div
          className="absolute inset-0 overflow-hidden rounded-[26px]"
          style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
        >
          <CardBack movie={movie} />
        </div>
      </div>
    </div>
  );
}

function CardFront({ movie, showHint }: { movie: Movie; showHint: boolean }) {
  const genres = movie.categories.map((c) => CATEGORY_LABELS[c]);
  return (
    <>
      <img src={movie.posterUrl} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
      <div
        className="absolute inset-0"
        style={{ background: "linear-gradient(to top, #000 4%, rgba(0,0,0,.72) 34%, rgba(0,0,0,.05) 68%)" }}
      />
      <div className="absolute inset-x-0 bottom-0 p-[22px] pb-6">
        {genres.length > 0 && (
          <p className="mb-2.5 font-mono text-[10px] font-medium uppercase tracking-[.2em] text-white/50">
            {genres.slice(0, 2).join(" · ")}
          </p>
        )}
        <h2 className="font-display text-[52px] uppercase leading-[.9] tracking-[.01em]" style={{ textWrap: "balance" }}>
          {movie.title}
        </h2>
        <p className="mt-2.5 text-[13px] text-white/62">
          {movie.year || "—"} · {movie.runtime ? `${movie.runtime} min` : "—"}
          {movie.contentRating ? ` · ${movie.contentRating}` : ""}
        </p>
      </div>
      {showHint && (
        <div
          className="absolute rounded-full px-2.5 py-[5px] font-mono text-[9.5px] tracking-[.12em] text-white/60"
          style={{ top: 14, right: 14, background: "rgba(0,0,0,.45)", backdropFilter: "blur(8px)" }}
        >
          TAP FOR DETAILS
        </div>
      )}
    </>
  );
}

function CardBack({ movie }: { movie: Movie }) {
  return (
    <>
      {movie.backdropUrl && (
        <img src={movie.backdropUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" draggable={false} />
      )}
      <div className="absolute inset-0 bg-[#08080b]/[.78]" />
      <div className="relative flex h-full flex-col justify-center gap-3.5 overflow-y-auto p-6">
        <h2 className="font-display text-[34px] leading-[.92]">{movie.title}</h2>
        {movie.tagline && <p className="font-sans text-[17px] italic text-white/55">{movie.tagline}</p>}
        <p className="text-sm leading-[1.6] text-white/85">{movie.summary}</p>
        {movie.directors.length > 0 && (
          <p className="text-[12.5px] leading-[1.5] text-white/55">
            <span className="font-medium text-white/85">Director:</span> {movie.directors.join(", ")}
          </p>
        )}
        {movie.cast.length > 0 && (
          <p className="text-[12.5px] leading-[1.5] text-white/55">
            <span className="font-medium text-white/85">Cast:</span> {movie.cast.join(", ")}
          </p>
        )}
        {movie.audienceRating != null && (
          <p className="font-mono text-[10px] tracking-[.14em] text-white/40">
            AUDIENCE {movie.audienceRating.toFixed(1)}
            {movie.criticRating != null ? ` · CRITIC ${movie.criticRating.toFixed(1)}` : ""}
          </p>
        )}
      </div>
    </>
  );
}
