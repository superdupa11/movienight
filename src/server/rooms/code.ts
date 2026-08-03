// 4 chars, A-Z minus vowels (no accidental words) — PROTOCOL §2.
const ALPHABET = "BCDFGHJKLMNPQRSTVWXYZ";

export function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}
