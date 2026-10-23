import { describe, expect, it } from "vitest";

import { effectiveMode, modeStatus, requestedMode } from "./execution-mode";

describe("execution mode", () => {
  it("treats a pending switch as the effective mode", () => {
    const pending = {
      executionMode: "work",
      pendingExecutionMode: "plan",
    } as const;
    expect(effectiveMode(pending)).toBe("plan");
    expect(requestedMode(pending, "plan")).toBeUndefined();
    expect(requestedMode(pending, "work")).toBe("work");
  });

  it("sends nothing for an ordinary reply in the current mode", () => {
    const work = { executionMode: "work", pendingExecutionMode: null } as const;
    expect(requestedMode(work, "work")).toBeUndefined();
    expect(requestedMode(work, "plan")).toBe("plan");
  });

  it("describes Plan mode and pending switches", () => {
    expect(
      modeStatus({ executionMode: "work", pendingExecutionMode: null })
    ).toBeNull();
    expect(
      modeStatus({ executionMode: "plan", pendingExecutionMode: null })
    ).toBe("Plan mode · read-only");
    expect(
      modeStatus({ executionMode: "plan", pendingExecutionMode: "work" })
    ).toBe("Switching to Work after current work");
    expect(
      modeStatus({ executionMode: "plan", pendingExecutionMode: "plan" })
    ).toBe("Plan mode · read-only");
  });
});
