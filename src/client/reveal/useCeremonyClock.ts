import { useEffect, useRef, useState } from "react";

const CELEBRATED_KEY_PREFIX = "movienight:celebrated:";

function alreadyCelebrated(key: string): boolean {
  try {
    return sessionStorage.getItem(CELEBRATED_KEY_PREFIX + key) === "1";
  } catch {
    return false;
  }
}

function markCelebrated(key: string): void {
  try {
    sessionStorage.setItem(CELEBRATED_KEY_PREFIX + key, "1");
  } catch {
    // sessionStorage unavailable (e.g. private mode) — ceremony just replays on refresh
  }
}

/**
 * One rAF clock for the match ceremony, in seconds since start. Jumps
 * straight to `total` (the settled reveal — the timeline functions are
 * analytic, so this renders correctly with no animation) under reduced
 * motion or when this result has already played once this session.
 */
export function useCeremonyClock(resultKey: string | undefined, total: number, instant: boolean) {
  // Decided once per mount, not re-checked inside the effect: StrictMode
  // runs this effect mount -> cleanup -> mount once in dev, and re-reading
  // sessionStorage on that second invocation would see the first
  // invocation's own markCelebrated() write and wrongly conclude a *prior*
  // session already played it, killing the ceremony every time in dev.
  const shouldAnimateRef = useRef<boolean | undefined>(undefined);
  if (shouldAnimateRef.current === undefined) {
    shouldAnimateRef.current = !instant && !(resultKey != null && alreadyCelebrated(resultKey));
  }
  const shouldAnimate = shouldAnimateRef.current;

  const [t, setT] = useState(() => (shouldAnimate ? 0 : total));
  const rafRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (resultKey == null || !shouldAnimate) return;
    markCelebrated(resultKey);
    setT(0);
    const t0 = performance.now();
    function tick(now: number) {
      const elapsed = (now - t0) / 1000;
      if (elapsed >= total) {
        setT(total);
        return;
      }
      setT(elapsed);
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultKey, total, shouldAnimate]);

  function skip() {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    setT(total);
  }

  return { t, skip };
}
