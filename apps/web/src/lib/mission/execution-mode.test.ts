import { describe, expect, it } from "vitest";

import { modeStatus } from "./execution-mode";

describe("execution mode", () => {
  it("shows only the read-only Plan status", () => {
    expect(modeStatus({ executionMode: "work" })).toBeNull();
    expect(modeStatus({ executionMode: "plan" })).toBe("Plan mode · read-only");
  });
});
