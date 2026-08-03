import { config } from "../config.js";

/**
 * Reveal-screen-only deep link into Plex Web for a title (PROTOCOL §6).
 * Contains no token — see the note on `match:found`/`runoff:result` in
 * shared/types.ts for why this is a deliberate, narrow exception to the
 * "no Plex URL reaches the client" invariant.
 */
export function plexWebUrl(ratingKey: string): string {
  const key = encodeURIComponent(`/library/metadata/${ratingKey}`);
  return `${config.plex.url}/web/index.html#!/details?key=${key}`;
}
