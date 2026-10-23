import { describe, expect, it } from "vitest";

import { backoffDelay } from "./backoff";

describe(backoffDelay, () => {
  it("stays within half and all of the exponential step", () => {
    for (const attempt of [1, 2, 3, 4, 5]) {
      const step = 500 * 2 ** (attempt - 1);
      expect(backoffDelay(attempt, { random: () => 0 })).toBe(step / 2);
      expect(backoffDelay(attempt, { random: () => 1 })).toBe(step);
    }
  });

  it("caps at maxMs no matter how many attempts", () => {
    expect(backoffDelay(50, { random: () => 1 })).toBe(15_000);
    expect(backoffDelay(50, { random: () => 0 })).toBe(7500);
    expect(backoffDelay(3, { maxMs: 1000, random: () => 1 })).toBe(1000);
  });
});
