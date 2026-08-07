import { Agent } from "undici";

// Samsung's own catalog id for the Plex app — stable across TVs (verified via
// this TV's local REST API), not deployment-specific, so it isn't env config.
const PLEX_APP_ID = "3201512006963";

/**
 * Launches Plex in the foreground on the given Samsung TV.
 *
 * The WebSocket remote-control API (`ed.apps.launch`) silently no-ops on this
 * TV's firmware — only the local REST API actually launches the app. See
 * docs/PROTOCOL.md §7 for how this was verified against the real device.
 *
 * Uses a fresh, single-use Agent per call rather than a shared/pooled one.
 * A pooled keep-alive connection to this TV works the first time, then fails
 * on the next cast — the TV closes its side of the idle socket between casts
 * (which, for movie night, can be hours or days apart) but undici's pool
 * doesn't find out until it tries to reuse it, so the request dies with a
 * stale-socket error instead of opening a new connection. A single request
 * per TV per cast is cheap enough that there's no reason to pool at all.
 */
export async function launchPlexApp(host: string): Promise<void> {
  const agent = new Agent({ connect: { rejectUnauthorized: false }, keepAliveTimeout: 1, pipelining: 0 });
  try {
    const url = `https://${host}:8002/api/v2/applications/${PLEX_APP_ID}`;
    const res = await fetch(url, { method: "POST", dispatcher: agent } as RequestInit & { dispatcher: Agent });
    if (!res.ok) throw new Error(`Samsung TV app launch -> ${res.status} ${res.statusText}`);
  } finally {
    await agent.close();
  }
}
