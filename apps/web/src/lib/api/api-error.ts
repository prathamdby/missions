import type { ApiError, ErrorCode } from "@missions/protocol/errors";

interface ApiRequestErrorInit {
  cause?: unknown;
  code: ErrorCode;
  message: string;
  requestId?: string;
  retryAfterMs?: number;
  status: number;
}

/** A failed daemon request, normalized to the protocol's ApiError shape. */
export class ApiRequestError extends Error {
  readonly code: ErrorCode;
  readonly requestId: string | undefined;
  readonly retryAfterMs: number | undefined;
  readonly status: number;

  constructor(init: ApiRequestErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = "ApiRequestError";
    this.code = init.code;
    this.requestId = init.requestId;
    this.retryAfterMs = init.retryAfterMs;
    this.status = init.status;
  }

  static fromPayload(payload: ApiError, status: number) {
    return new ApiRequestError({ ...payload.error, status });
  }
}

export const isApiError = (error: unknown): error is ApiRequestError =>
  error instanceof ApiRequestError;

export const errorMessage = (error: unknown) => {
  if (isApiError(error) || error instanceof Error) {
    return error.message;
  }
  return "Something went wrong.";
};

/**
 * Stale `expectedRevision`, `epoch`, or plan revision: refresh and retry.
 * `conflict` is excluded: the daemon uses it for refusals whose message the
 * user needs to read (rejected push, nothing to commit, missing gh).
 */
export const isStaleError = (error: unknown) =>
  isApiError(error) && error.code === "stale_revision";
