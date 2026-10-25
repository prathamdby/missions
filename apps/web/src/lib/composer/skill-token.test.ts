import { describe, expect, it } from "vitest";

import { skillTokenLength } from "./skill-token";

describe(skillTokenLength, () => {
  it("recognizes only complete leading skills from the catalog without changing text", () => {
    const catalog = [
      { kind: "skill", name: "review" },
      { kind: "command", name: "inspect" },
    ];
    expect(skillTokenLength("/review", catalog)).toBe(7);
    expect(skillTokenLength("/review these files\nwith detail", catalog)).toBe(
      7
    );
    for (const text of [
      "/rev",
      "/review-more",
      "/unknown",
      "/inspect file",
      " /review",
      "Run /review",
    ]) {
      expect(skillTokenLength(text, catalog)).toBe(0);
    }
    expect(skillTokenLength("/review", [])).toBe(0);
  });
});
