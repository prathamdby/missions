import { describe, expect, it } from "vitest";

import { nativeTodos } from "./native-todos";

describe("native TodoWrite", () => {
  it("parses the native numbered checklist and keeps its order", () => {
    expect(
      nativeTodos({
        todos:
          "1. [completed] Explore\n2. [in_progress] Build\n3. [pending] Test",
      })
    ).toStrictEqual([
      { content: "Explore", priority: "medium", status: "completed" },
      { content: "Build", priority: "medium", status: "in_progress" },
      { content: "Test", priority: "medium", status: "pending" },
    ]);
  });

  it("accepts structured input, preserves priority, and supports clearing", () => {
    expect(
      nativeTodos({
        todos: [{ content: "Build", priority: "high", status: "pending" }],
      })
    ).toStrictEqual([
      { content: "Build", priority: "high", status: "pending" },
    ]);
    expect(nativeTodos({ todos: "" })).toStrictEqual([]);
    expect(nativeTodos({ todos: [] })).toStrictEqual([]);
  });

  it.each([
    {},
    { todos: null },
    { todos: "not a checklist" },
    { todos: [{ content: "Bad", status: "unknown" }] },
    { todos: "1. [pending] Valid\nbroken" },
  ])(
    "rejects malformed input without replacing the saved list: %j",
    (input) => {
      expect(nativeTodos(input)).toBeNull();
    }
  );
});
