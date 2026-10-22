import type { ErrorCode } from "@missions/protocol/errors";

/** An error whose message is safe to show the user. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly retryAfterMs: number | undefined;

  constructor(code: ErrorCode, message: string, retryAfterMs?: number) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

export const notFound = (what: string) =>
  new AppError("not_found", `${what} not found`);
export const conflict = (message: string) => new AppError("conflict", message);
export const stale = (message: string) =>
  new AppError("stale_revision", message);
export const badRequest = (message: string) =>
  new AppError("bad_request", message);
