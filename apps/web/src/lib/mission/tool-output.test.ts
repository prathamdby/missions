import { describe, expect, it } from "vitest";

import {
  editDiff,
  exitCodeOf,
  lineTone,
  outputTail,
  passedCount,
  runTime,
} from "./tool-output";

describe(exitCodeOf, () => {
  it("reads the code from common footers", () => {
    expect(exitCodeOf("FAIL a\nExit code: 1")).toBe(1);
    expect(exitCodeOf("Process exited with code 2")).toBe(2);
    expect(exitCodeOf("all good")).toBeNull();
  });
});

describe(lineTone, () => {
  it("colors test runner lines", () => {
    expect(lineTone(" PASS  base.md matches snapshot")).toBe("success");
    expect(lineTone(" FAIL  tool-use › retries once")).toBe("danger");
    expect(lineTone(" RUNS  src/agent/run.test.ts")).toBe("warning");
    expect(lineTone("Tests: 3 failed, 6 passed, 9 total")).toBe("secondary");
  });
});

describe(outputTail, () => {
  it("drops blank lines and the exit footer, keeping the last lines", () => {
    const text = [
      ...Array.from({ length: 10 }, (_, i) => `line ${i}`),
      "",
      "Exit code: 1",
    ].join("\n");
    expect(outputTail(text)).toStrictEqual(
      Array.from({ length: 8 }, (_, i) => `line ${i + 2}`)
    );
  });
});

describe(passedCount, () => {
  it("finds the passed count", () => {
    expect(passedCount("Tests: 9 passed (9)")).toBe("9 passed");
    expect(passedCount("done")).toBeNull();
  });
});

describe(runTime, () => {
  it("uses tenths under a minute", () => {
    expect(runTime(3400)).toBe("3.4s");
    expect(runTime(125_000)).toBe("2m 05s");
  });
});

describe(editDiff, () => {
  it("lists removed then added lines for edits, and added lines for new files", () => {
    expect(editDiff("Edit", { new_str: "b\nc", old_str: "a" })).toStrictEqual([
      { kind: "del", text: "a" },
      { kind: "add", text: "b" },
      { kind: "add", text: "c" },
    ]);
    expect(editDiff("Create", { content: "x" })).toStrictEqual([
      { kind: "add", text: "x" },
    ]);
  });
});
