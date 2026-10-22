import { errorStatus } from "@missions/protocol/errors";
import type { ApiError, ErrorCode } from "@missions/protocol/errors";
import { HEALTH_PATH, HealthResponseSchema } from "@missions/protocol/health";
import type { HealthResponse } from "@missions/protocol/health";
import { PROTOCOL_VERSION } from "@missions/protocol/version";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { AppError } from "./lib/app-error";
import { localBoundary } from "./security/boundary";
import type { BoundaryOptions } from "./security/boundary";

export interface AppOptions {
  version: string;
  startedAt: Date;
  now?: () => Date;
  /** Omitted only by tests that exercise routes without the loopback boundary. */
  boundary?: Omit<BoundaryOptions, "publicPaths">;
  register?: (app: Hono) => void;
}

const errorBody = (
  code: ErrorCode,
  message: string,
  retryAfterMs?: number
): ApiError => ({
  error: {
    code,
    message,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  },
});

export const createApp = ({
  version,
  startedAt,
  now = () => new Date(),
  boundary,
  register,
}: AppOptions) => {
  const app = new Hono();

  if (boundary) {
    app.use(localBoundary({ ...boundary, publicPaths: [HEALTH_PATH] }));
  }

  app.get(HEALTH_PATH, (c) => {
    const body: HealthResponse = HealthResponseSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      service: "missions-daemon",
      startedAt: startedAt.toISOString(),
      status: "ok",
      uptimeMs: Math.max(0, now().getTime() - startedAt.getTime()),
      version,
    });
    return c.json(body);
  });

  register?.(app);

  app.notFound((c) =>
    c.json(
      errorBody("not_found", "Route not found"),
      errorStatus.not_found as ContentfulStatusCode
    )
  );

  // Only AppError messages are user-safe; anything else can carry paths, tokens, or repository content.
  app.onError((failure, c) => {
    if (failure instanceof AppError) {
      return c.json(
        errorBody(failure.code, failure.message, failure.retryAfterMs),
        errorStatus[failure.code] as ContentfulStatusCode
      );
    }
    return c.json(
      errorBody("internal", "Internal error"),
      errorStatus.internal as ContentfulStatusCode
    );
  });

  return app;
};
