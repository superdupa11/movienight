import { useEffect, useMemo, useState } from "react";
import type { LibrarySummaryDTO } from "../../shared/types";
import { useRoom } from "../shared/RoomContext";
import ScanQR from "./ScanQR";

const prefersReducedMotion =
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const POSTER_PLACEHOLDER_COUNT = 10;

function shuffled<T>(items: T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = next[i];
    next[i] = next[j]!;
    next[j] = tmp!;
  }
  return next;
}

function useLibrarySummary(): LibrarySummaryDTO | undefined {
  const [summary, setSummary] = useState<LibrarySummaryDTO>();
  useEffect(() => {
    let cancelled = false;
    fetch("/api/library/summary")
      .then((res) => (res.ok ? (res.json() as Promise<LibrarySummaryDTO>) : undefined))
      .then((data) => {
        if (!cancelled && data) setSummary(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return summary;
}

export default function Landing() {
  const { createRoom, joinRoom } = useRoom();
  const params = new URLSearchParams(location.search);
  const [mode, setMode] = useState<"create" | "join">("join");
  const [code, setCode] = useState((params.get("code") ?? "").toUpperCase().slice(0, 4));
  const [codeFocused, setCodeFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [soloBusy, setSoloBusy] = useState(false);
  const [soloError, setSoloError] = useState<string>();
  const [scanning, setScanning] = useState(false);

  function switchMode(next: "create" | "join") {
    setMode(next);
    setError(undefined);
  }

  async function joinWithCode(rawCode: string) {
    const upper = rawCode.toUpperCase().slice(0, 4);
    setMode("join");
    setCode(upper);
    setError(undefined);
    setBusy(true);
    const res = await joinRoom(upper);
    setBusy(false);
    if (!res.ok) setError(res.message);
  }

  async function submit() {
    if (busy) return;
    if (mode === "join") {
      if (code.length < 4) return;
      await joinWithCode(code);
      return;
    }
    setBusy(true);
    const res = await createRoom();
    setBusy(false);
    if (!res.ok) setError(res.message);
  }

  // Independent of the card above — doesn't touch mode/code/error state, so it
  // can't leave the join tab in a confusing half-updated state.
  async function soloShortcut() {
    if (soloBusy) return;
    setSoloBusy(true);
    setSoloError(undefined);
    const res = await createRoom(true);
    setSoloBusy(false);
    if (!res.ok) setSoloError(res.message);
  }

  function onCode(e: React.ChangeEvent<HTMLInputElement>) {
    setCode(e.target.value.toUpperCase().slice(0, 4));
    setError(undefined);
  }

  const ctaLabel = mode === "join" ? "Join room" : "Create room";
  const ctaHint = mode === "join" ? "ASK THE HOST FOR THE CODE" : "SHARE THE CODE OR THE QR NEXT";
  const ctaDisabled = busy || (mode === "join" && code.length < 4);

  const cells = Array.from({ length: 4 }, (_, i) => {
    const filled = i < code.length;
    const isCaret = i === code.length;
    const char = filled ? code[i] : isCaret ? "|" : "";
    const ring = error
      ? "shadow-[inset_0_0_0_1px_rgba(226,72,63,.55)]"
      : isCaret && codeFocused
        ? "shadow-[inset_0_0_0_1px_rgba(255,255,255,.4)]"
        : "shadow-[inset_0_0_0_1px_rgba(255,255,255,.1)]";
    return { char, ring, filled };
  });

  return (
    <div className="relative min-h-screen overflow-hidden bg-ink-950 text-white">
      <PosterWall />
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(8,8,11,.3)_0%,rgba(8,8,11,.62)_40%,rgba(8,8,11,.88)_72%,#08080b_94%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[340px] bg-[radial-gradient(120%_100%_at_50%_0%,rgba(226,72,63,.14)_0%,rgba(8,8,11,0)_72%)]" />

      <div
        className="relative mx-auto flex min-h-screen w-full max-w-[430px] flex-col px-6"
        style={{ paddingTop: "max(54px, env(safe-area-inset-top))", paddingBottom: "max(32px, env(safe-area-inset-bottom))" }}
      >
        <div className="flex flex-col items-center gap-2.5">
          <div className="flex gap-[5px]">
            <span className="h-[7px] w-[7px] rounded-full bg-white/[.22]" />
            <span className="h-[7px] w-[7px] rounded-full bg-white/[.22]" />
            <span className="h-[7px] w-[7px] rounded-full bg-white/[.22]" />
          </div>
          <h1
            className="mt-1 text-center font-display uppercase leading-[.86] tracking-[.04em]"
            style={{
              fontSize: "clamp(48px, 15vw, 62px)",
              WebkitTextStroke: "1.25px rgba(0,0,0,.8)",
              textShadow: "0 2px 14px rgba(0,0,0,.5)",
            }}
          >
            Binger
          </h1>
          <p
            className="text-center font-mono text-[10px] tracking-[.22em] text-white/70"
            style={{ textShadow: "0 1px 3px rgba(0,0,0,.9), 0 2px 10px rgba(0,0,0,.7)" }}
          >
            ADMIT ALL · ONE UNANIMOUS YES
          </p>
        </div>

        <div className="mt-[34px] overflow-hidden rounded-[20px] bg-ink-900/[.92] shadow-[inset_0_0_0_1px_rgba(255,255,255,.07),0_30px_60px_-24px_rgba(0,0,0,.9)] backdrop-blur-md">
          <div className="flex flex-col gap-[18px] px-5 pb-5 pt-[22px]">
            <div role="tablist" className="flex rounded-full bg-ink-700 p-1 text-sm font-medium">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "create"}
                onClick={() => switchMode("create")}
                className={`min-h-10 flex-1 rounded-full transition ${mode === "create" ? "bg-white text-ink-950" : "text-white/70"}`}
              >
                Host a room
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "join"}
                onClick={() => switchMode("join")}
                className={`min-h-10 flex-1 rounded-full transition ${mode === "join" ? "bg-white text-ink-950" : "text-white/70"}`}
              >
                Join a room
              </button>
            </div>

            {mode === "join" ? (
              <div>
                <p className="mb-[9px] font-mono text-[10px] tracking-[.2em] text-white/[.42]">ROOM CODE</p>
                <label className="relative flex cursor-text gap-2.5">
                  {cells.map((cell, i) => (
                    <div
                      key={i}
                      className={`flex flex-1 items-center justify-center rounded-xl bg-ink-800 font-mono text-[32px] font-semibold ${cell.filled ? "text-white" : "text-white/35"} ${cell.ring}`}
                      style={{ aspectRatio: "3 / 4" }}
                    >
                      {cell.char}
                    </div>
                  ))}
                  <input
                    type="text"
                    inputMode="text"
                    autoCapitalize="characters"
                    maxLength={4}
                    value={code}
                    onChange={onCode}
                    onFocus={() => setCodeFocused(true)}
                    onBlur={() => setCodeFocused(false)}
                    aria-label="Room code"
                    className="absolute inset-0 h-full w-full cursor-text border-0 bg-transparent text-[32px] text-transparent opacity-0 caret-transparent"
                  />
                </label>
              </div>
            ) : null}
          </div>

          <div className="relative h-[26px]">
            <div className="absolute left-5 right-5 top-1/2 border-t-[1.5px] border-dashed border-white/[.14]" />
            <div className="absolute -left-[13px] top-1/2 h-[26px] w-[26px] -translate-y-1/2 rounded-full bg-ink-950" />
            <div className="absolute -right-[13px] top-1/2 h-[26px] w-[26px] -translate-y-1/2 rounded-full bg-ink-950" />
          </div>

          <div className="flex flex-col gap-2.5 px-5 pb-[22px] pt-4">
            <button
              type="button"
              disabled={ctaDisabled}
              onClick={submit}
              className={`min-h-[54px] w-full rounded-[14px] text-[17px] font-semibold transition active:scale-[0.98] ${
                ctaDisabled ? "bg-white/[.14] text-white/40" : "bg-white text-ink-950"
              }`}
            >
              {busy ? "…" : ctaLabel}
            </button>
            <p className={`text-center font-mono text-[9.5px] tracking-[.18em] ${error ? "text-no" : "text-white/30"}`}>
              {error ?? ctaHint}
            </p>
          </div>
        </div>

        <div className="mt-auto flex flex-col gap-[14px] pt-7">
          <div className="flex items-center gap-3">
            <div className="flex-1 border-t border-white/[.08]" />
            <span className="font-mono text-[10px] tracking-[.2em] text-white/30">OR</span>
            <div className="flex-1 border-t border-white/[.08]" />
          </div>
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={() => setScanning(true)}
              className="min-h-[50px] flex-1 rounded-[13px] bg-ink-800 text-sm font-medium text-white"
            >
              Scan a QR
            </button>
            <button
              type="button"
              disabled={soloBusy}
              onClick={soloShortcut}
              className="min-h-[50px] flex-1 rounded-[13px] bg-ink-800 text-sm font-medium text-white disabled:opacity-50"
            >
              {soloBusy ? "…" : "Solo picks"}
            </button>
          </div>
          {soloError && <p className="text-center text-[11px] text-no">{soloError}</p>}
          <LibraryStatus />
        </div>
      </div>

      {scanning && (
        <ScanQR
          onClose={() => setScanning(false)}
          onScan={(scannedCode) => {
            setScanning(false);
            void joinWithCode(scannedCode);
          }}
        />
      )}
    </div>
  );
}

function LibraryStatus() {
  const summary = useLibrarySummary();
  if (!summary) return null;
  return (
    <p className="text-center font-mono text-[10px] tracking-[.18em] text-yes">
      ● LIBRARY READY · {summary.totalTitles} TITLES
    </p>
  );
}

function PosterWall() {
  const summary = useLibrarySummary();

  const columns = useMemo(() => {
    const ids = summary?.posterIds ?? [];
    if (ids.length === 0) return null;
    const shuffledIds = shuffled(ids);
    const size = Math.max(1, Math.ceil(shuffledIds.length / 3));
    return [shuffledIds.slice(0, size), shuffledIds.slice(size, size * 2), shuffledIds.slice(size * 2)];
  }, [summary]);

  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 mx-auto grid w-full max-w-[430px] grid-cols-3 gap-2 p-2 opacity-90"
    >
      <PosterColumn ids={columns?.[0] ?? []} anim="up" duration={46} />
      <PosterColumn ids={columns?.[1] ?? []} anim="down" duration={58} />
      <PosterColumn ids={columns?.[2] ?? []} anim="up" duration={68} />
    </div>
  );
}

function PosterColumn({ ids, anim, duration }: { ids: string[]; anim: "up" | "down"; duration: number }) {
  // Empty (still loading, or an empty library) -> flat placeholder tiles, never the design's striped mock art.
  const tiles = ids.length > 0 ? ids : Array.from({ length: POSTER_PLACEHOLDER_COUNT }, () => undefined);
  const track = prefersReducedMotion ? tiles : [...tiles, ...tiles];

  return (
    <div className="relative overflow-hidden">
      <div
        className="flex flex-col gap-2"
        style={prefersReducedMotion ? undefined : { animation: `mn-${anim} ${duration}s linear infinite`, willChange: "transform" }}
      >
        {track.map((id, i) => (
          <div key={i} className="aspect-[2/3] overflow-hidden rounded-[10px] bg-ink-800">
            {id && (
              <img
                src={`/art/${id}/poster.webp`}
                alt=""
                loading="lazy"
                decoding="async"
                draggable={false}
                className="h-full w-full object-cover"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
