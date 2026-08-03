import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { SESSION_TOKEN_EXPIRY } from "../../shared/types.js";

export type SessionTokenPayload = { roomCode: string; userId: string };

export function signSessionToken(payload: SessionTokenPayload): string {
  return jwt.sign(payload, config.sessionSecret, { expiresIn: SESSION_TOKEN_EXPIRY });
}

export function verifySessionToken(token: string): SessionTokenPayload | undefined {
  try {
    const decoded = jwt.verify(token, config.sessionSecret);
    if (typeof decoded === "object" && decoded && "roomCode" in decoded && "userId" in decoded) {
      return { roomCode: String(decoded.roomCode), userId: String(decoded.userId) };
    }
    return undefined;
  } catch {
    return undefined;
  }
}
