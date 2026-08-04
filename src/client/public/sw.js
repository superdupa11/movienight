// Presence-only service worker: satisfies Chrome's installability
// criteria without caching anything. Room state and votes are live
// socket.io/API traffic — caching them here would show stale data.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
