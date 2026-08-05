import { useEffect, useState } from "react";
import type { ScannedPlexClient, TvDevice } from "../../shared/types";

type Props = { onClose: () => void };

export default function Devices({ onClose }: Props) {
  const [devices, setDevices] = useState<TvDevice[]>([]);
  const [scanned, setScanned] = useState<ScannedPlexClient[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string>();
  const [addingId, setAddingId] = useState<string>();

  async function loadDevices() {
    const res = await fetch("/api/devices");
    if (res.ok) setDevices(await res.json());
  }

  useEffect(() => {
    void loadDevices();
  }, []);

  async function scan() {
    setScanning(true);
    setScanError(undefined);
    setScanned([]);
    try {
      const res = await fetch("/api/devices/scan");
      if (!res.ok) throw new Error();
      setScanned(await res.json());
    } catch {
      setScanError("Couldn't reach Plex — check the server's Plex connection.");
    } finally {
      setScanning(false);
    }
  }

  async function addDevice(client: ScannedPlexClient) {
    setAddingId(client.plexMachineIdentifier);
    await fetch("/api/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: client.plexName,
        plexMachineIdentifier: client.plexMachineIdentifier,
        plexProduct: client.plexProduct,
      }),
    });
    setAddingId(undefined);
    await loadDevices();
  }

  async function removeDevice(id: string) {
    await fetch(`/api/devices/${id}`, { method: "DELETE" });
    await loadDevices();
  }

  const savedIds = new Set(devices.map((d) => d.plexMachineIdentifier));
  const newlyDiscovered = scanned.filter((c) => !savedIds.has(c.plexMachineIdentifier));

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink-950 text-white">
      <div
        className="flex items-center justify-between px-5 pb-4"
        style={{ paddingTop: "max(20px, env(safe-area-inset-top))" }}
      >
        <h2 className="text-lg font-semibold">Devices</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full bg-ink-800 px-4 py-2 text-sm font-medium text-white/80 ring-1 ring-white/10 transition active:scale-95"
        >
          Done
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-8">
        <p className="mb-4 font-mono text-[10px] tracking-[.18em] text-white/40">
          OPEN PLEX ON A TV, THEN SCAN TO ADD IT
        </p>

        <button
          type="button"
          onClick={scan}
          disabled={scanning}
          className="mb-5 min-h-[50px] w-full rounded-[13px] bg-white text-[15px] font-semibold text-ink-950 transition active:scale-[0.98] disabled:opacity-50"
        >
          {scanning ? "Scanning…" : "Scan for devices"}
        </button>

        {scanError && <p className="mb-4 text-center text-[12px] text-no">{scanError}</p>}

        {newlyDiscovered.length > 0 && (
          <div className="mb-6 flex flex-col gap-2">
            <p className="font-mono text-[10px] tracking-[.18em] text-white/40">FOUND</p>
            {newlyDiscovered.map((c) => (
              <div key={c.plexMachineIdentifier} className="flex items-center justify-between rounded-xl bg-ink-800 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.plexName}</p>
                  <p className="font-mono text-[10px] tracking-[.1em] text-white/40">{c.plexProduct}</p>
                </div>
                <button
                  type="button"
                  onClick={() => addDevice(c)}
                  disabled={addingId === c.plexMachineIdentifier}
                  className="ml-3 shrink-0 rounded-full bg-yes px-4 py-1.5 text-[13px] font-semibold text-ink-950 transition active:scale-95 disabled:opacity-50"
                >
                  {addingId === c.plexMachineIdentifier ? "…" : "Add"}
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <p className="font-mono text-[10px] tracking-[.18em] text-white/40">SAVED</p>
          {devices.length === 0 && <p className="text-sm text-white/40">No devices yet.</p>}
          {devices.map((d) => (
            <div key={d.id} className="flex items-center justify-between rounded-xl bg-ink-800 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{d.name}</p>
                {d.plexProduct && <p className="font-mono text-[10px] tracking-[.1em] text-white/40">{d.plexProduct}</p>}
              </div>
              <button
                type="button"
                onClick={() => removeDevice(d.id)}
                className="ml-3 shrink-0 rounded-full bg-ink-700 px-4 py-1.5 text-[13px] font-medium text-white/70 transition active:scale-95"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
