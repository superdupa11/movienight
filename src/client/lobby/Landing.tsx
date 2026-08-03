import { useState } from "react";
import { useRoom } from "../shared/RoomContext";

export default function Landing() {
  const { createRoom, joinRoom } = useRoom();
  const params = new URLSearchParams(location.search);
  const [mode, setMode] = useState<"create" | "join">(params.get("code") ? "join" : "create");
  const [name, setName] = useState("");
  const [code, setCode] = useState(params.get("code") ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function submit() {
    if (!name.trim()) return setError("Enter your name");
    setBusy(true);
    setError(undefined);
    const res = mode === "create" ? await createRoom(name.trim()) : await joinRoom(code.trim(), name.trim());
    setBusy(false);
    if (!res.ok) setError(res.message);
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 text-center">
      <div>
        <h1 className="text-4xl font-bold tracking-tight">🎬 Movie Night</h1>
        <p className="mt-2 text-ink-700 text-white/60">Swipe together. First unanimous yes wins.</p>
      </div>

      <div className="flex rounded-full bg-ink-800 p-1 text-sm font-medium">
        <button
          className={`rounded-full px-5 py-2 transition ${mode === "create" ? "bg-white text-ink-950" : "text-white/70"}`}
          onClick={() => setMode("create")}
        >
          Host a room
        </button>
        <button
          className={`rounded-full px-5 py-2 transition ${mode === "join" ? "bg-white text-ink-950" : "text-white/70"}`}
          onClick={() => setMode("join")}
        >
          Join a room
        </button>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-3">
        <input
          className="rounded-xl bg-ink-800 px-4 py-3 text-center text-lg outline-none ring-1 ring-white/10 focus:ring-white/40"
          placeholder="Your name"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
        />
        {mode === "join" && (
          <input
            className="rounded-xl bg-ink-800 px-4 py-3 text-center text-2xl font-mono uppercase tracking-[0.3em] outline-none ring-1 ring-white/10 focus:ring-white/40"
            placeholder="CODE"
            value={code}
            maxLength={4}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          disabled={busy}
          onClick={submit}
          className="mt-2 rounded-xl bg-white py-3 text-lg font-semibold text-ink-950 transition active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? "…" : mode === "create" ? "Create room" : "Join room"}
        </button>
      </div>
    </div>
  );
}
