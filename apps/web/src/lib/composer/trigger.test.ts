import { describe, expect, it } from "vitest";

import { composerTrigger, insertSuggestion } from "./trigger";

describe("composer triggers", () => {
  it.each([
    ["/", "command", "", 0],
    ["/build", "command", "build", 0],
    ["@sett", "file", "sett", 0],
    ["Check @src/set", "file", "src/set", 6],
    ["Check\n@src", "file", "src", 6],
  ] as const)("parses %s at the caret", (text, kind, query, start) => {
    expect(composerTrigger(text, text.length)).toStrictEqual({
      kind,
      query,
      range: { end: text.length, start },
    });
  });

  it.each([
    " /build",
    "try /build",
    "/build args",
    "mail@example.com",
    "@one@two",
    "hello",
    "https://docs",
  ])("does not open a picker for %s", (text) => {
    expect(composerTrigger(text, text.length)).toBeNull();
  });

  it("replaces the whole token when choosing in the middle and preserves following text", () => {
    const text = "Read @sett-old now";
    const trigger = composerTrigger(text, 10);
    expect(trigger).toStrictEqual({
      kind: "file",
      query: "sett",
      range: { end: 14, start: 5 },
    });
    if (!trigger) {
      throw new Error("Missing trigger");
    }
    expect(insertSuggestion(text, trigger, "src/settings.ts")).toStrictEqual({
      cursor: 22,
      text: "Read @src/settings.ts  now",
    });
  });

  it("rejects invalid cursor positions", () => {
    expect([composerTrigger("@x", -1), composerTrigger("@x", 3)]).toStrictEqual(
      [null, null]
    );
  });
});
