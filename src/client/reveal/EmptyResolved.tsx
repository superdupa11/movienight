import { useRoom } from "../shared/RoomContext";

export default function EmptyResolved() {
  const { state, resetSession, leaveRoom } = useRoom();
  const isHost = state.you?.id === state.hostId;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-4xl">🤷</p>
      <h1 className="text-2xl font-bold">Nobody liked anything</h1>
      <p className="text-white/60">{state.emptyMessage ?? "Try widening your filters."}</p>
      {isHost ? (
        <button onClick={resetSession} className="mt-4 rounded-xl bg-white px-6 py-3 font-semibold text-ink-950">
          Try again
        </button>
      ) : (
        <p className="text-sm text-white/50">Waiting for the host to start a new round…</p>
      )}
      <button onClick={leaveRoom} className="text-sm text-white/40 transition hover:text-white/60">
        Leave room
      </button>
    </div>
  );
}
