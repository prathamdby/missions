import { describe, expect, it } from "vitest";

import { answerLabel, parseOption } from "./questions";

const RECOMMENDED =
  "Inject a clock into the retry queue (Recommended) — Tests control time directly.";

describe(parseOption, () => {
  it("splits the label, the Recommended tag, and the detail", () => {
    expect(parseOption(RECOMMENDED)).toStrictEqual({
      detail: "Tests control time directly.",
      label: "Inject a clock into the retry queue",
      recommended: true,
    });
  });

  it("keeps a plain option as its label", () => {
    expect(parseOption("Not now")).toStrictEqual({
      detail: "",
      label: "Not now",
      recommended: false,
    });
  });
});

describe(answerLabel, () => {
  it("shortens chosen options to their labels", () => {
    expect(answerLabel([RECOMMENDED, "Not now"], RECOMMENDED)).toBe(
      "Inject a clock into the retry queue"
    );
    expect(answerLabel([RECOMMENDED], "Something else")).toBe("Something else");
  });
});
