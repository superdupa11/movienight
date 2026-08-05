import { config } from "../config.js";
import { launchPlexApp } from "../tv/samsungTv.js";

export type PlexDevice = { id: string; name: string; product: string; canPlay: boolean };

export type CastStatus =
  | { state: "LAUNCHING" }
  | { state: "WAITING_FOR_SIGNIN" }
  | { state: "PLAYING" }
  | { state: "ERROR"; message: string };

// Grace window before we tell the host "check the TV" — normal (already
// signed in) launches register within a few seconds; see docs/PROTOCOL.md §7.
const LAUNCH_GRACE_MS = 15_000;
// Long enough for a human to notice a PIN sign-in prompt and complete it —
// deliberately not auto-solved (PROTOCOL §7): Plex's PIN flow exists so a
// leaked token can't silently authorize new devices, and we don't have a
// confirmed way to bypass it from the LAN side.
const CAST_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 2_000;

const PLEX_HEADERS = {
  Accept: "application/json",
  "X-Plex-Client-Identifier": "binger-server",
  "X-Plex-Product": "Binger",
  "X-Plex-Device-Name": "Binger",
  "X-Plex-Platform": "Node",
};

function plexUrl(path: string): URL {
  const url = new URL(config.plex.url + path);
  url.searchParams.set("X-Plex-Token", config.plex.token);
  return url;
}

async function plexFetchJson<T>(url: URL, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...PLEX_HEADERS, ...(init?.headers as Record<string, string>) } });
  if (!res.ok) throw new Error(`Plex ${url.pathname} -> ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

let cachedMachineIdentifier: string | undefined;
async function serverMachineIdentifier(): Promise<string> {
  if (!cachedMachineIdentifier) {
    const data = await plexFetchJson<{ MediaContainer: { machineIdentifier: string } }>(plexUrl("/identity"));
    cachedMachineIdentifier = data.MediaContainer.machineIdentifier;
  }
  return cachedMachineIdentifier;
}

type PlexClientEntry = { machineIdentifier: string; name: string; product: string; protocolCapabilities?: string };

export async function listPlayers(): Promise<PlexDevice[]> {
  const data = await plexFetchJson<{ MediaContainer: { Server?: PlexClientEntry[] } }>(plexUrl("/clients"));
  return (data.MediaContainer.Server ?? []).map((c) => ({
    id: c.machineIdentifier,
    name: c.name,
    product: c.product,
    canPlay: (c.protocolCapabilities ?? "").split(",").includes("playback"),
  }));
}

/**
 * Cues a title on a Plex client, proxied through PMS.
 *
 * Two non-obvious requirements, found only by testing against the real
 * client (docs/PROTOCOL.md §7):
 *  - "Plex for Samsung" reports its own address as 127.0.0.1, so playback
 *    commands must be proxied through PMS (X-Plex-Target-Client-Identifier)
 *    rather than sent to the client's self-reported address.
 *  - The client rejects the account's own X-Plex-Token on this endpoint. It
 *    needs a scoped, single-use "delegation" token minted just for this call.
 */
async function playOnDevice(deviceId: string, ratingKey: string): Promise<void> {
  const pmsId = await serverMachineIdentifier();

  const tokenData = await plexFetchJson<{ MediaContainer: { token: string } }>(
    plexUrl("/security/token?type=delegation&scope=all"),
  );
  const delegationToken = tokenData.MediaContainer.token;

  const uri = `server://${pmsId}/com.plexapp.plugins.library/library/metadata/${ratingKey}`;
  const pqUrl = plexUrl("/playQueues");
  pqUrl.searchParams.set("type", "video");
  pqUrl.searchParams.set("uri", uri);
  const pqData = await plexFetchJson<{ MediaContainer: { playQueueID: number } }>(pqUrl, { method: "POST" });
  const playQueueID = pqData.MediaContainer.playQueueID;

  const pmsHost = new URL(config.plex.url);
  const url = new URL(config.plex.url + "/player/playback/playMedia");
  url.searchParams.set("key", `/library/metadata/${ratingKey}`);
  url.searchParams.set("offset", "0");
  url.searchParams.set("machineIdentifier", pmsId);
  url.searchParams.set("address", pmsHost.hostname);
  url.searchParams.set("port", pmsHost.port || "32400");
  url.searchParams.set("protocol", pmsHost.protocol.replace(":", ""));
  url.searchParams.set("type", "video");
  url.searchParams.set("providerIdentifier", "com.plexapp.plugins.library");
  url.searchParams.set("containerKey", `/playQueues/${playQueueID}?own=1&window=100`);
  url.searchParams.set("commandID", "1");
  url.searchParams.set("token", delegationToken); // NOT X-Plex-Token — see docstring above

  const res = await fetch(url, { headers: { ...PLEX_HEADERS, "X-Plex-Target-Client-Identifier": deviceId } });
  if (!res.ok) throw new Error(`playMedia -> ${res.status} ${res.statusText}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Launches Plex on the configured TV, waits for `plexMachineIdentifier`
 * specifically to register as a controllable client, then cues `ratingKey`.
 * Reports progress via `onStatus` so the caller can broadcast it (Room emits
 * `plex:castStatus`).
 *
 * Matching a specific machineIdentifier — not just "the first playable
 * client" — matters as soon as more than one Plex client is on the network:
 * an earlier version picked whichever client Plex's `/clients` happened to
 * list first, which silently targeted the wrong TV (or both, via a
 * duplicate-registration quirk we saw) once a second TV was on. See
 * docs/PROTOCOL.md §7.
 *
 * Deliberately does not attempt to solve a Plex PIN sign-in screen — if the
 * app isn't already signed in, the client won't register within the grace
 * window, and WAITING_FOR_SIGNIN tells the host to go complete it manually.
 */
export async function castToTv(
  plexMachineIdentifier: string,
  ratingKey: string,
  onStatus: (status: CastStatus) => void,
): Promise<void> {
  onStatus({ state: "LAUNCHING" });
  try {
    await launchPlexApp();
  } catch (e) {
    onStatus({ state: "ERROR", message: e instanceof Error ? e.message : String(e) });
    return;
  }

  const start = Date.now();
  let device: PlexDevice | undefined;
  let flaggedSignIn = false;
  while (Date.now() - start < CAST_TIMEOUT_MS) {
    device = (await listPlayers()).find((d) => d.id === plexMachineIdentifier && d.canPlay);
    if (device) break;
    if (!flaggedSignIn && Date.now() - start > LAUNCH_GRACE_MS) {
      flaggedSignIn = true;
      onStatus({ state: "WAITING_FOR_SIGNIN" });
    }
    await sleep(POLL_INTERVAL_MS);
  }

  if (!device) {
    onStatus({ state: "ERROR", message: "Plex never became available on the TV." });
    return;
  }

  try {
    await playOnDevice(device.id, ratingKey);
    onStatus({ state: "PLAYING" });
  } catch (e) {
    onStatus({ state: "ERROR", message: e instanceof Error ? e.message : String(e) });
  }
}
