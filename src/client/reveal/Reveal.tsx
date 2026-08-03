import { useRoom } from "../shared/RoomContext";

export default function Reveal() {
  const { state, resetSession } = useRoom();
  const result = state.result;
  const isHost = state.you?.id === state.hostId;
  if (!result) return null;
  const { movie } = result;

  return (
    <div className="relative flex min-h-screen flex-col justify-end overflow-hidden">
      {movie.backdropUrl && (
        <img src={movie.backdropUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/80 to-black/30" />

      <div className="relative z-10 flex flex-col gap-4 p-6 pb-10">
        {result.note && <p className="text-sm font-medium text-amber-300">{result.note}</p>}
        <p className="text-sm font-semibold uppercase tracking-widest text-white/60">
          {result.via === "match" ? "It's a match" : `Runoff winner · ${result.votes} vote${result.votes === 1 ? "" : "s"}`}
        </p>

        <div className="flex items-end gap-4">
          <img src={movie.posterUrl} alt="" className="aspect-poster w-24 flex-shrink-0 rounded-xl object-cover shadow-xl" />
          <div>
            <h1 className="text-3xl font-bold leading-tight text-white">{movie.title}</h1>
            <p className="mt-1 text-white/70">
              {movie.year || "—"} · {movie.runtime ? `${movie.runtime} min` : "—"}
            </p>
          </div>
        </div>

        <div className="mt-4 flex gap-3">
          <a
            href={result.plexUrl}
            target="_blank"
            rel="noreferrer"
            className="flex-1 rounded-xl bg-white/15 py-3 text-center font-semibold text-white ring-1 ring-white/20"
          >
            Open in Plex
          </a>
          {isHost && (
            <button
              onClick={resetSession}
              className="flex-1 rounded-xl bg-white py-3 text-center font-semibold text-ink-950"
            >
              Start over
            </button>
          )}
        </div>
        {!isHost && <p className="text-center text-sm text-white/50">Waiting for the host to start a new round…</p>}
      </div>
    </div>
  );
}
