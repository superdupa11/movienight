import { Agent, WebSocket } from "undici";

// Shown on the TV's own "Allow [X] to connect?" pairing prompt.
const CLIENT_NAME = Buffer.from("Binger").toString("base64");
// Generous: the TV only replies once a human has tapped Allow on a first-time
// pairing prompt, which won't happen the instant we connect.
const CONNECT_TIMEOUT_MS = 15_000;

export type SendKeyResult =
  | { ok: true; token: string | null }
  | { ok: false; reason: "PAIRING_REQUIRED" | "TIMEOUT" | "ERROR"; message: string };

/**
 * Sends one remote-control key to a Samsung TV over its WebSocket channel —
 * a different surface from `samsungTv.ts`'s REST app-launch call, used here
 * for the sleep timer's `KEY_POWER` (docs/PROTOCOL.md §7.2).
 *
 * First connection from a given `token` (null) pops an on-screen "Allow this
 * device?" prompt on the TV; nothing proceeds until a human accepts it. Once
 * accepted, the TV replies with a token that skips the prompt on future
 * connections — callers should persist the returned `token` and pass it back
 * in. Like `launchPlexApp`, opens a fresh single-use connection per call
 * rather than keeping one alive.
 */
export async function sendKey(host: string, key: string, token: string | null): Promise<SendKeyResult> {
  const agent = new Agent({ connect: { rejectUnauthorized: false } });
  try {
    const url = new URL(`wss://${host}:8002/api/v2/channels/samsung.remote.control`);
    url.searchParams.set("name", CLIENT_NAME);
    if (token) url.searchParams.set("token", token);

    return await new Promise<SendKeyResult>((resolve) => {
      let settled = false;
      const settle = (result: SendKeyResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        ws.close();
        resolve(result);
      };

      const timeout = setTimeout(
        () => settle({ ok: false, reason: "TIMEOUT", message: "TV didn't respond — approve the connection request on the TV, then try again." }),
        CONNECT_TIMEOUT_MS,
      );

      const ws = new WebSocket(url, { dispatcher: agent });

      ws.addEventListener("message", (ev) => {
        let msg: { event?: string; data?: { token?: string } };
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (msg.event !== "ms.channel.connect") return;
        ws.send(
          JSON.stringify({
            method: "ms.remote.control",
            params: { Cmd: "Click", DataOfCmd: key, Option: "false", TypeOfRemote: "SendRemoteKey" },
          }),
        );
        // No ack for key sends — give the TV a moment to process before
        // tearing the socket down.
        setTimeout(() => settle({ ok: true, token: msg.data?.token ?? token }), 500);
      });

      ws.addEventListener("close", () =>
        settle({ ok: false, reason: "PAIRING_REQUIRED", message: "Connection closed before pairing completed — approve the request on the TV." }),
      );
      ws.addEventListener("error", () => settle({ ok: false, reason: "ERROR", message: "Couldn't reach the TV's remote-control channel." }));
    });
  } finally {
    await agent.close();
  }
}
