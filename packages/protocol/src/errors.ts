import { z } from "zod";

export const ErrorCodeSchema = z.enum([
  "bad_request",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "stale_revision",
  "rate_limited",
  "unavailable",
  "internal",
]);

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ApiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: ErrorCodeSchema,
    message: z.string().min(1),
    requestId: z.string().min(1).optional(),
    retryAfterMs: z.int().nonnegative().optional(),
  }),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

export const errorStatus: Record<ErrorCode, number> = {
  bad_request: 400,
  conflict: 409,
  forbidden: 403,
  internal: 500,
  not_found: 404,
  rate_limited: 429,
  stale_revision: 409,
  unauthorized: 401,
  unavailable: 503,
};
