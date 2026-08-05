import { useEffect, useState } from "react";
import { useRoom } from "./RoomContext";

const VISIBLE_MS = 4000;

// Room-wide notices (currently just player:left) surfaced as a transient
// banner. Rendered once at the App root so it's visible on every screen,
// not just ones with a player roster (Reveal/EmptyResolved have none).
export default function Toast() {
  const { state } = useRoom();
  const notice = state.notice;
  const [shownAt, setShownAt] = useState<number>();

  useEffect(() => {
    if (!notice) return;
    setShownAt(notice.at);
    const timer = setTimeout(() => setShownAt(undefined), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  if (!notice || shownAt !== notice.at) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-[max(env(safe-area-inset-top,0px),1rem)]">
      <div className="pointer-events-auto rounded-full bg-ink-800/95 px-4 py-2 text-xs font-medium text-white/80 shadow-lg ring-1 ring-white/10 backdrop-blur">
        {notice.message}
      </div>
    </div>
  );
}
