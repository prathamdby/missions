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

  it("preserves fenced interfaces before or inside numbered steps", () => {
    const ui = '```openui-lang\nroot = Stack([Text("Approach")])\n```';
    expect(parsePlan(`${ui}\n\n1. Implement it`)).toBeNull();
    expect(
      parsePlan(
        `1. Implement it\n${ui
          .split("\n")
          .map((line) => `   ${line}`)
          .join("\n")}`
      )
    ).toBeNull();
  });

  it.each(["```", "~~~", "````", "~~~~"])(
    "preserves closed and unclosed %s fences before or inside steps",
    (fence) => {
      const opening = `${fence}openui-lang\nroot = Stack([Text("Approach")])`;
      for (const ui of [opening, `${opening}\n${fence}`]) {
        expect(parsePlan(`${ui}\n\n1. Implement it`)).toBeNull();
        expect(
          parsePlan(
            `1. Implement it\n${ui
              .split("\n")
              .map((line) => `   ${line}`)
              .join("\n")}`
          )
        ).toBeNull();
      }
    }
  );
});
