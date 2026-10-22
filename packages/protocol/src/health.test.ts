import { describe, expect, it } from "vitest";

import { ApiErrorSchema } from "./errors";
import { HEALTH_PATH, HealthResponseSchema } from "./health";

const valid = {
  protocolVersion: 1,
  service: "missions-daemon",
  startedAt: "2026-10-22T12:00:00.000Z",
  status: "ok",
  uptimeMs: 0,
  version: "0.0.0",
};

describe("health contract", () => {
  it("is versioned under /v1", () => {
    expect(HEALTH_PATH).toBe("/v1/health");
  });

  it("accepts a well-formed response", () => {
    expect(HealthResponseSchema.parse(valid)).toStrictEqual(valid);
  });

  it.each([
    ["wrong protocol version", { ...valid, protocolVersion: 2 }],
    ["negative uptime", { ...valid, uptimeMs: -1 }],
    ["non-ISO start time", { ...valid, startedAt: "yesterday" }],
    ["unknown field", { ...valid, token: "secret" }],
  ])("rejects %s", (_label, body) => {
    expect(HealthResponseSchema.safeParse(body).success).toBeFalsy();
  });
});

describe("error contract", () => {
  it("rejects unknown codes and extra fields", () => {
    expect(
      ApiErrorSchema.safeParse({ error: { code: "teapot", message: "x" } })
        .success
    ).toBeFalsy();
    expect(
      ApiErrorSchema.safeParse({
        error: { code: "internal", message: "x", stack: "..." },
      }).success
    ).toBeFalsy();
  });
});
