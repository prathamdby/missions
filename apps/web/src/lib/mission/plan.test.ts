import { describe, expect, it } from "vitest";

import { parsePlan } from "./plan";

describe(parsePlan, () => {
  it("reads a summary and numbered Title — detail steps", () => {
    const parsed = parsePlan(
      [
        "# Plan",
        "",
        "Give the retry queue an injectable clock.",
        "",
        "1. **Add a Clock interface** — src/time/clock.ts with a fake clock",
        "2. Prove it — run the suite 50 times",
        "   with zero failures",
      ].join("\n")
    );
    expect(parsed).toStrictEqual({
      steps: [
        {
          detail: "src/time/clock.ts with a fake clock",
          title: "Add a Clock interface",
        },
        {
          detail: "run the suite 50 times with zero failures",
          title: "Prove it",
        },
      ],
      summary: "Give the retry queue an injectable clock.",
    });
  });

  it("falls back to Markdown for other shapes", () => {
    expect(parsePlan("## Plan\n\n- one\n- two")).toBeNull();
    expect(parsePlan("Just a paragraph.")).toBeNull();
    expect(parsePlan("1. Step\n\nTrailing prose")).toBeNull();
  });
});
