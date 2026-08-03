import type { Movie } from "../../shared/types";
import { CATEGORY_LABELS } from "../../shared/types";

export default function Card({ movie, flipped, onFlip }: { movie: Movie; flipped: boolean; onFlip: () => void }) {
  return (
    <div
      onClick={onFlip}
      className="relative aspect-poster w-full select-none overflow-hidden rounded-3xl bg-ink-800 shadow-2xl ring-1 ring-white/10"
    >
      {flipped ? <CardBack movie={movie} /> : <CardFront movie={movie} />}
    </div>
  );
}

function CardFront({ movie }: { movie: Movie }) {
  return (
    <>
      <img src={movie.posterUrl} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/70 to-transparent p-4 pt-16">
        <h2 className="text-2xl font-bold leading-tight text-white">{movie.title}</h2>
        <p className="mt-1 text-sm text-white/70">
          {movie.year || "—"} · {movie.runtime ? `${movie.runtime} min` : "—"}
          {movie.contentRating ? ` · ${movie.contentRating}` : ""}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {movie.categories.slice(0, 3).map((c) => (
            <span key={c} className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs text-white">
              {CATEGORY_LABELS[c]}
            </span>
          ))}
        </div>
      </div>
      <div className="absolute right-3 top-3 rounded-full bg-black/40 px-2 py-1 text-[10px] text-white/70">tap for details</div>
    </>
  );
}

function CardBack({ movie }: { movie: Movie }) {
  return (
    <>
      {movie.backdropUrl && (
        <img src={movie.backdropUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" draggable={false} />
      )}
      <div className="absolute inset-0 bg-ink-950/70" />
      <div className="relative flex h-full flex-col justify-center gap-3 overflow-y-auto p-5">
        <h2 className="text-xl font-bold text-white">{movie.title}</h2>
        {movie.tagline && <p className="text-sm italic text-white/60">{movie.tagline}</p>}
        <p className="text-sm leading-relaxed text-white/85">{movie.summary}</p>
        {movie.directors.length > 0 && (
          <p className="text-sm text-white/60">
            <span className="font-semibold text-white/80">Director:</span> {movie.directors.join(", ")}
          </p>
        )}
        {movie.cast.length > 0 && (
          <p className="text-sm text-white/60">
            <span className="font-semibold text-white/80">Cast:</span> {movie.cast.join(", ")}
          </p>
        )}
        {movie.audienceRating != null && (
          <p className="text-sm text-white/60">⭐ {movie.audienceRating.toFixed(1)} audience</p>
        )}
      </div>
    </>
  );
}
