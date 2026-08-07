import type Database from "better-sqlite3";
import { getRemoteToken, setRemoteToken } from "../db/devices.js";
import { isSessionActive } from "../plex/playback.js";
import { sendKey } from "./samsungRemote.js";

export type SleepTimerStatus = { state: "ARMED" } | { state: "CANCELLED" } | { state: "FIRED" } | { state: "ERROR"; message: string };

// How often to ask Plex whether the session is still there.
const POLL_INTERVAL_MS = 60_000;
// Consecutive misses before treating the session as really gone rather than
// a momentary blip — about 3 minutes, enough to ride out a scene transition
// or a quick trip to the PMS UI without misreading it as "done."
const MISS_GRACE_POLLS = 3;
// Backstop so a monitor can't outlive a movie night by days if something
// about the session check wedges (see the launch-connection bug this same
// failure mode caused in samsungTv.ts) — not the intended trigger path.
const MAX_MONITOR_MS = 6 * 60 * 60 * 1000;

type Handle = { cancel: () => void };
const activeByDevice = new Map<string, Handle>();

/**
 * Arms a sleep timer for `device`: polls Plex for whether `plexMachineIdentifier`
 * still has a live session (playing, paused, or buffering all count — only a
 * session disappearing entirely means "done"), and once it's been gone for
 * `MISS_GRACE_POLLS` in a row, sends `KEY_POWER` to `ipAddress` over the
 * Samsung WS remote (docs/PROTOCOL.md §7.2).
 *
 * Only one timer runs per device — arming again (a new cast to the same TV)
 * cancels whatever was running before.
 */
export function armSleepTimer(
  db: Database.Database,
  device: { id: string; plexMachineIdentifier: string; ipAddress: string },
  onStatus: (status: SleepTimerStatus) => void,
): void {
  activeByDevice.get(device.id)?.cancel();

  let done = false;
  let missStreak = 0;
  let polling = false;

  const finish = (status: SleepTimerStatus) => {
    if (done) return;
    done = true;
    clearInterval(poll);
    clearTimeout(ceiling);
    activeByDevice.delete(device.id);
    onStatus(status);
  };

  const poll = setInterval(() => {
    if (polling) return; // don't overlap a slow tick with the next one
    polling = true;
    void (async () => {
      try {
        const active = await isSessionActive(device.plexMachineIdentifier);
        if (active) {
          missStreak = 0;
          return;
        }
        missStreak += 1;
        if (missStreak < MISS_GRACE_POLLS) return;

        const result = await sendKey(device.ipAddress, "KEY_POWER", getRemoteToken(db, device.id));
        if (result.ok) {
          if (result.token) setRemoteToken(db, device.id, result.token);
          finish({ state: "FIRED" });
        } else {
          finish({ state: "ERROR", message: result.message });
        }
      } catch (e) {
        // Transient Plex hiccup — don't let it count as "movie's over."
        console.warn("[sleep-timer] session check failed:", e instanceof Error ? e.message : e);
      } finally {
        polling = false;
      }
    })();
  }, POLL_INTERVAL_MS);

  const ceiling = setTimeout(() => finish({ state: "CANCELLED" }), MAX_MONITOR_MS);

  activeByDevice.set(device.id, { cancel: () => finish({ state: "CANCELLED" }) });
  onStatus({ state: "ARMED" });
}

export function cancelSleepTimer(deviceId: string): void {
  activeByDevice.get(deviceId)?.cancel();
}
