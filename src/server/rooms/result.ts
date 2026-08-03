import type { ErrorCode } from "../../shared/types.js";

export type Result = { ok: true } | { ok: false; error: ErrorCode; message?: string };

export const ok = (): Result => ({ ok: true });
export const err = (error: ErrorCode, message?: string): Result => ({ ok: false, error, message });
