import { useState } from "react";
import { useRoom } from "../shared/RoomContext";

export default function Runoff() {
  const { state, runoffPick, forceRunoff } = useRoom();
  const [picked, setPicked] = useState<string>();
  const isHost = state.you?.id === state.hostId;
  const candidates = state.runoffCandidates ?? [];

  function pick(movieId: string) {
    setPicked(movieId);
    runoffPick(movieId);
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-8">
      <header className="text-center">
        <h1 className="text-2xl font-bold">Runoff</h1>
        <p className="mt-1 text-white/60">Everyone picks their favorite of the top {candidates.length}.</p>
      </header>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {candidates.map((c) => (
          <button
            key={c.movie.id}
            onClick={() => pick(c.movie.id)}
            className={`overflow-hidden rounded-2xl ring-2 transition ${
              picked === c.movie.id ? "ring-white" : "ring-transparent"
            }`}
          >
            <img src={c.movie.posterUrl} alt="" className="aspect-poster w-full object-cover" />
            <div className="bg-ink-800 p-2 text-left">
              <p className="truncate text-sm font-semibold">{c.movie.title}</p>
              <p className="text-xs text-white/50">{c.movie.year}</p>
            </div>
          </button>
        ))}
      </div>

      <div className="mt-auto flex flex-col items-center gap-3">
        <p className="text-white/60">
          {state.runoffTally?.picksIn ?? 0} / {state.runoffTally?.total ?? state.players.length} picked in
        </p>
        {isHost && (
          <button onClick={forceRunoff} className="rounded-xl bg-ink-800 px-5 py-2 text-sm text-white/80 ring-1 ring-white/10">
            Force result now
          </button>
        )}
      </div>
    </div>
  );
}
