import { useEffect, useRef } from "react";
import { useRoom } from "../shared/RoomContext";

const PRELOAD_COUNT = 5;

function preload(url: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = url;
  });
}

export default function BuildingScreen() {
  const { state, clientReady } = useRoom();
  const ackedRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const hash = state.buildingDeckHash;
    if (!hash || ackedRef.current === hash) return;
    ackedRef.current = hash;

    const urls = (state.buildingAssetUrls ?? []).slice(0, PRELOAD_COUNT);
    Promise.all(urls.map(preload)).then(() => clientReady(hash));
  }, [state.buildingDeckHash, state.buildingAssetUrls, clientReady]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-center">
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-white/20 border-t-white" />
      <p className="text-lg text-white/70">Shuffling the deck…</p>
    </div>
  );
}
