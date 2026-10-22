import { z } from "zod";

import { apiPath, PROTOCOL_VERSION } from "./version";

export const HEALTH_PATH = apiPath("/health");

export const HealthResponseSchema = z.strictObject({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  service: z.literal("missions-daemon"),
  startedAt: z.iso.datetime(),
  status: z.literal("ok"),
  uptimeMs: z.int().nonnegative(),
  version: z.string().min(1),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
