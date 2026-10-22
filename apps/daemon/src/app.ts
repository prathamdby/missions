import { errorStatus } from "@missions/protocol/errors";
import type { ApiError, ErrorCode } from "@missions/protocol/errors";
import { HEALTH_PATH, HealthResponseSchema } from "@missions/protocol/health";
import type { HealthResponse } from "@missions/protocol/health";
import { PROTOCOL_VERSION } from "@missions/protocol/version";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export interface AppOptions {
  version: string;
  startedAt: Date;
  now?: () => Date;
}

const errorBody = (code: ErrorCode, message: string): ApiError => ({
  error: { code, message },
});

export const createApp = ({
  version,
  startedAt,
  now = () => new Date(),
}: AppOptions) => {
  const app = new Hono();

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

  app.notFound((c) =>
    c.json(
      errorBody("not_found", "Route not found"),
      errorStatus.not_found as ContentfulStatusCode
    )
  );

  // Never echo internal error text: it can carry paths, tokens, or repository content.
  app.onError((_error, c) =>
    c.json(
      errorBody("internal", "Internal error"),
      errorStatus.internal as ContentfulStatusCode
    )
  );

  return app;
};
