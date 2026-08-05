import { Agent } from "undici";
import { config } from "../config.js";

// Samsung's own catalog id for the Plex app — stable across TVs (verified via
// this TV's local REST API), not deployment-specific, so it isn't env config.
const PLEX_APP_ID = "3201512006963";

// The TV's local API serves a self-signed cert; trust is established by being
// on the LAN behind our own network boundary, not by cert validation. Scoped
// to this one Agent instance — doesn't touch global fetch/TLS behavior.
const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

/**
 * Launches Plex in the foreground on the configured TV.
 *
 * The WebSocket remote-control API (`ed.apps.launch`) silently no-ops on this
 * TV's firmware — only the local REST API actually launches the app. See
 * docs/PROTOCOL.md §7 for how this was verified against the real device.
 */
export async function launchPlexApp(): Promise<void> {
  const url = `https://${config.tv.samsungHost}:8002/api/v2/applications/${PLEX_APP_ID}`;
  const res = await fetch(url, { method: "POST", dispatcher: insecureAgent } as RequestInit & { dispatcher: Agent });
  if (!res.ok) throw new Error(`Samsung TV app launch -> ${res.status} ${res.statusText}`);
}
