import type { Changes, FileDiff } from "@missions/protocol/files";
import type { Mission } from "@missions/protocol/missions";
import { describe, expect, it } from "vitest";

import { hunkGaps, splitPath } from "./changes";
import { canArchive, defaultCommitMessage, finishState } from "./finish";

const workspace: NonNullable<Mission["workspace"]> = {
  baseRef: "main",
  baselineDirtyFiles: [],
  branch: "missions/demo",
  createdAt: "2026-01-01T00:00:00.000Z",
  id: "w",
  missionId: "m",
  mode: "new_worktree",
  owned: true,
  path: "/tmp/w",
  projectId: "p",
  repoRoot: "/tmp/r/.git",
  startRevision: "abc",
};

const publish: Mission["publish"] = {
  cleanup: "none",
  cleanupReason: null,
  commits: [],
  pr: null,
  pushedBranch: null,
  remote: null,
};

const file = (path: string, extra: Partial<FileDiff> = {}): FileDiff => ({
  additions: 1,
  binary: false,
  committed: false,
  deletions: 0,
  hunks: [],
  oldPath: null,
  path,
  preExisting: false,
  status: "modified",
  truncated: false,
  ...extra,
});

const changes = (files: FileDiff[]): Changes => ({
  baseRevision: "abc",
  files,
  hash: "h",
  head: "abc",
  totals: { additions: files.length, deletions: 0, files: files.length },
});

const hunk = (start: number, count: number) => ({
  header: `@@ -${start},${count} +${start},${count} @@`,
  lines: Array.from({ length: count }, (_, index) => ({
    kind: "context" as const,
    newNumber: start + index,
    oldNumber: start + index,
    text: "",
  })),
});

describe(finishState, () => {
  it("waits for a finished mission and loaded changes", () => {
    expect(
      finishState({ publish, status: "running", workspace }, changes([])).step
    ).toBe("none");
    expect(
      finishState({ publish, status: "completed", workspace }, undefined).step
    ).toBe("none");
    expect(canArchive("completed")).toBeTruthy();
    expect(canArchive("running")).toBeFalsy();
  });

  it("commits uncommitted files and flags pre-existing ones", () => {
    const state = finishState(
      { publish, status: "completed", workspace },
      changes([
        file("a.ts"),
        file("b.ts", { preExisting: true }),
        file("c.ts", { committed: true }),
      ])
    );
    expect(state.step).toBe("commit");
    expect(state.pending.map((entry) => entry.path)).toStrictEqual([
      "a.ts",
      "b.ts",
    ]);
    expect(state.preExisting.map((entry) => entry.path)).toStrictEqual([
      "b.ts",
    ]);
  });

  it("moves from push to PR to review as the publish record fills in", () => {
    const committed = changes([file("a.ts", { committed: true })]);
    const commits = [{ message: "Add a", sha: "def" }];
    const status = "completed" as const;
    expect(
      finishState(
        { publish: { ...publish, commits }, status, workspace },
        committed
      ).step
    ).toBe("push");
    expect(
      finishState(
        {
          publish: { ...publish, commits, pushedBranch: "missions/demo" },
          status,
          workspace,
        },
        committed
      ).step
    ).toBe("pr");
    expect(finishState({ publish, status, workspace }, changes([])).step).toBe(
      "empty"
    );
  });
});

describe(defaultCommitMessage, () => {
  it("uses the title as subject and the summary as body", () => {
    expect(
      defaultCommitMessage({ summary: " Did it. ", title: "Add notes" })
    ).toBe("Add notes\n\nDid it.");
    expect(defaultCommitMessage({ summary: null, title: "Add notes" })).toBe(
      "Add notes"
    );
  });
});

describe("changes helpers", () => {
  it("splits a path into directory and name", () => {
    expect(splitPath("src/agent/assemble.ts")).toStrictEqual({
      dir: "src/agent/",
      name: "assemble.ts",
    });
    expect(splitPath("README.md")).toStrictEqual({
      dir: "",
      name: "README.md",
    });
  });

  it("counts unchanged lines hidden between hunks", () => {
    expect(hunkGaps([hunk(1, 3), hunk(10, 2), hunk(12, 1)])).toStrictEqual([
      0, 6, 0,
    ]);
    expect(hunkGaps([hunk(5, 1)])).toStrictEqual([4]);
  });
});
