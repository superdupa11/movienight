const KEY = "movienight:session";

export type StoredSession = { code: string; token: string };

export function loadSession(): StoredSession | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : undefined;
  } catch {
    return undefined;
  }
}

export function saveSession(session: StoredSession): void {
  localStorage.setItem(KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(KEY);
}
