import { ApiErrorSchema } from "@missions/protocol/errors";
import { HEALTH_PATH, HealthResponseSchema } from "@missions/protocol/health";
import { describe, expect, it } from "vitest";

import { createApp } from "./app";

const startedAt = new Date("2026-10-22T12:00:00.000Z");
const app = createApp({
  now: () => new Date("2026-10-22T12:00:01.500Z"),
  startedAt,
  version: "1.2.3",
});

describe("GET /v2/health", () => {
  it("returns a response that satisfies the protocol schema", async () => {
    const res = await app.request(HEALTH_PATH);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = HealthResponseSchema.parse(await res.json());
    expect(body).toStrictEqual({
      protocolVersion: 2,
      service: "missions-daemon",
      startedAt: "2026-10-22T12:00:00.000Z",
      status: "ok",
      uptimeMs: 1500,
      version: "1.2.3",
    });
  });

  it("clamps uptime when the clock moves backwards", async () => {
    const skewed = createApp({
      now: () => new Date("2026-10-22T11:59:00.000Z"),
      startedAt,
      version: "1.2.3",
    });
    const res = await skewed.request(HEALTH_PATH);
    const body = HealthResponseSchema.parse(await res.json());
    expect(body.uptimeMs).toBe(0);
  });
});

describe("error shape", () => {
  it("returns a schema-valid 404 for unknown routes", async () => {
    const res = await app.request("/v2/nope");
    expect(res.status).toBe(404);
    expect(ApiErrorSchema.parse(await res.json()).error.code).toBe("not_found");
  });

  it("hides internal error details", async () => {
    const failing = createApp({
      now: () => {
        throw new Error("/home/secret/path");
      },
      startedAt,
      version: "1.2.3",
    });
    const res = await failing.request(HEALTH_PATH);
    expect(res.status).toBe(500);
    const body = ApiErrorSchema.parse(await res.json());
    expect(body.error).toStrictEqual({
      code: "internal",
      message: "Internal error",
    });
  });
});
