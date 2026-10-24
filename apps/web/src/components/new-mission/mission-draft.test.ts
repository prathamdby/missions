import type { Project } from "@missions/protocol/projects";
import type { Settings } from "@missions/protocol/settings";
import { describe, expect, it } from "vitest";

import {
  chooseModels,
  defaultWorkspace,
  draftDefaults,
  nextDirtyAcknowledgement,
  resolveProject,
  reviewMissionDraft,
} from "./mission-draft";
import type { Evidence } from "./mission-draft";

const confirmed = <T>(data: T): Evidence<T> => ({
  confirmed: true,
  data,
  version: 1,
});
const project: Project = {
  createdAt: "2026-01-01T00:00:00Z",
  defaultBranch: "main",
  id: "project",
  kind: "git",
  name: "Project",
  path: "/project",
  remoteUrl: null,
};
const settings: Settings = {
  cleanupAfterMerge: false,
  defaultAutonomy: "medium",
  defaultWorkspaceMode: "new_worktree",
  maxConcurrentWorkers: 2,
  orchestrator: { modelId: "planner", reasoningEffort: "high" },
  worker: { modelId: "builder", reasoningEffort: null },
  worktreeRoot: "/worktrees",
};

const input = (): Parameters<typeof reviewMissionDraft>[0] => ({
  acknowledged: null,
  autonomy: "medium",
  branch: "main",
  branches: confirmed([{ current: true, name: "main", remote: false }]),
  checkout: confirmed({
    branch: "main",
    dirty: false,
    dirtyFiles: [],
    path: "/project",
  }),
  goal: "  Ship a tested outcome  ",
  newBranch: null,
  project,
  projectsConfirmed: true,
  settings: confirmed(settings),
  workspace: { mode: "new_worktree" },
  worktrees: confirmed([
    {
      branch: "feature",
      dirty: false,
      head: "commit",
      isMain: false,
      path: "/worktree",
    },
  ]),
});

describe("new-mission workflows", () => {
  it("forgets consent after changed or clean evidence, not during an unknown refetch", () => {
    expect([
      nextDirtyAcknowledgement("reviewed", {
        dirtyKey: null,
        workspaceKnown: false,
      }),
      nextDirtyAcknowledgement("reviewed", {
        dirtyKey: "reviewed",
        workspaceKnown: true,
      }),
      nextDirtyAcknowledgement("reviewed", {
        dirtyKey: null,
        workspaceKnown: true,
      }),
      nextDirtyAcknowledgement("reviewed", {
        dirtyKey: "different",
        workspaceKnown: true,
      }),
    ]).toStrictEqual(["reviewed", "reviewed", null, null]);
  });

  it("builds the complete trimmed request with confirmed model defaults and new branch", () => {
    expect(
      reviewMissionDraft({ ...input(), newBranch: "missions/feature" }).draft
    ).toStrictEqual({
      autonomy: "medium",
      goal: "Ship a tested outcome",
      orchestrator: settings.orchestrator,
      projectId: project.id,
      worker: settings.worker,
      workspace: {
        baseBranch: "main",
        branchName: "missions/feature",
        mode: "new_worktree",
      },
    });
  });

  it("unknown or failed reads with retained data never authorize current-checkout editing", () => {
    const value = input();
    value.workspace = { mode: "current_checkout" };
    value.checkout.confirmed = false;
    expect(reviewMissionDraft(value)).toMatchObject({
      draft: null,
      workspaceKnown: false,
    });
    value.checkout.data = undefined;
    expect(reviewMissionDraft(value).draft).toBeNull();
  });

  it("requires an existing worktree in the confirmed fetched list, never a stale arbitrary path", () => {
    const value = input();
    value.workspace = { mode: "existing_worktree", path: "/missing" };
    expect(reviewMissionDraft(value).draft).toBeNull();
    value.workspace = { mode: "existing_worktree", path: "/worktree" };
    expect(reviewMissionDraft(value).draft?.workspace).toStrictEqual({
      acknowledgeDirty: false,
      mode: "existing_worktree",
      path: "/worktree",
    });
    value.worktrees.confirmed = false;
    expect(reviewMissionDraft(value).draft).toBeNull();
    value.worktrees = confirmed([
      {
        branch: "main",
        dirty: false,
        head: null,
        isMain: true,
        path: "/worktree",
      },
    ]);
    expect(reviewMissionDraft(value).draft).toBeNull();
  });

  it("acknowledges the reviewed dirty filenames, insensitive to ordering but not changed membership", () => {
    const value = input();
    value.workspace = { mode: "current_checkout" };
    value.checkout = confirmed({
      branch: "main",
      dirty: true,
      dirtyFiles: ["a.ts", "b.ts"],
      path: "/project",
    });
    const review = reviewMissionDraft(value);
    expect(review).toMatchObject({
      dirtyCount: 2,
      draft: null,
      needsAcknowledge: true,
    });
    value.acknowledged = review.dirtyKey;
    expect(reviewMissionDraft(value).draft?.workspace).toStrictEqual({
      acknowledgeDirty: true,
      mode: "current_checkout",
    });
    value.checkout = confirmed({
      branch: "main",
      dirty: true,
      dirtyFiles: ["b.ts", "a.ts"],
      path: "/project",
    });
    expect(reviewMissionDraft(value).needsAcknowledge).toBeFalsy();
    value.checkout = confirmed({
      branch: "main",
      dirty: true,
      dirtyFiles: ["c.ts", "a.ts"],
      path: "/project",
    });
    expect(reviewMissionDraft(value)).toMatchObject({
      draft: null,
      needsAcknowledge: true,
    });
    value.project = { ...project, id: "other" };
    expect(reviewMissionDraft(value).needsAcknowledge).toBeTruthy();
  });

  it("a new worktree does not require acknowledgement of dirty source checkout files", () => {
    const value = input();
    value.checkout = confirmed({
      branch: "main",
      dirty: true,
      dirtyFiles: ["a.ts"],
      path: "/project",
    });
    expect(reviewMissionDraft(value)).toMatchObject({
      dirtyCount: 1,
      dirtyKey: null,
      needsAcknowledge: false,
    });
    expect(reviewMissionDraft(value).draft).not.toBeNull();
  });

  it("requires renewed review for each fresh dirty-worktree fetch without filename evidence", () => {
    const value = input();
    value.workspace = { mode: "existing_worktree", path: "/worktree" };
    value.worktrees = confirmed([
      {
        branch: "feature",
        dirty: true,
        head: "commit",
        isMain: false,
        path: "/worktree",
      },
    ]);
    value.acknowledged = reviewMissionDraft(value).dirtyKey;
    expect(reviewMissionDraft(value).draft).not.toBeNull();
    value.worktrees = { ...value.worktrees, version: 2 };
    expect(reviewMissionDraft(value)).toMatchObject({
      draft: null,
      needsAcknowledge: true,
    });
  });

  it("blocks missing branch, failed branch/settings reads, blank goal, and removed project", () => {
    const value = input();
    expect([
      reviewMissionDraft({ ...value, branch: "missing" }).draft,
      reviewMissionDraft({
        ...value,
        branches: { ...value.branches, confirmed: false },
      }).draft,
      reviewMissionDraft({
        ...value,
        settings: { ...value.settings, confirmed: false },
      }).draft,
      reviewMissionDraft({ ...value, goal: " \n " }).draft,
      reviewMissionDraft({ ...value, projectsConfirmed: false }).draft,
      reviewMissionDraft({ ...value, project: null }).draft,
    ]).toStrictEqual([null, null, null, null, null, null]);
  });

  it("supports a directory checkout without disabled git query evidence", () => {
    const value = input();
    value.project = { ...project, kind: "directory" };
    value.workspace = { mode: "current_checkout" };
    value.checkout = { confirmed: false, data: undefined, version: 0 };
    expect(reviewMissionDraft(value).draft?.workspace).toStrictEqual({
      acknowledgeDirty: false,
      mode: "current_checkout",
    });
  });

  it("starts with the chosen models instead of the Settings defaults", () => {
    const fast = { modelId: "fast", reasoningEffort: null };
    const defaults = draftDefaults(confirmed(settings));
    const models = chooseModels(defaults, { worker: fast });
    expect(reviewMissionDraft({ ...input(), models }).draft).toMatchObject({
      orchestrator: settings.orchestrator,
      worker: fast,
    });
  });

  it("reads draft defaults only from confirmed Settings", () => {
    expect(
      draftDefaults({ confirmed: false, data: settings, version: 1 })
    ).toBeNull();
    expect(chooseModels(null, {})).toBeNull();
    expect(draftDefaults(confirmed(settings))).toStrictEqual({
      models: { orchestrator: settings.orchestrator, worker: settings.worker },
      workspaceMode: "new_worktree",
    });
  });

  it("follows the saved workspace default for Git projects and runs non-Git folders in place", () => {
    const inPlace = { workspaceMode: "current_checkout" as const };
    const worktree = { workspaceMode: "new_worktree" as const };
    expect([
      defaultWorkspace(true, worktree),
      defaultWorkspace(true, inPlace),
      defaultWorkspace(true, null),
      defaultWorkspace(false, worktree),
      defaultWorkspace(false, inPlace),
    ]).toStrictEqual([
      { mode: "new_worktree" },
      { mode: "current_checkout" },
      { mode: "new_worktree" },
      { mode: "current_checkout" },
      { mode: "current_checkout" },
    ]);
  });

  it("an explicit frozen default survives newer mission activity and never falls back after removal", () => {
    const other = { ...project, id: "other" };
    const recent = {
      createdAt: project.createdAt,
      id: "mission",
      projectId: "other",
      status: "running" as const,
      title: "Recent",
      updatedAt: project.createdAt,
    };
    expect(resolveProject([project, other], [recent], null)?.id).toBe("other");
    expect(resolveProject([project, other], [recent], project.id)?.id).toBe(
      project.id
    );
    expect(resolveProject([other], [recent], project.id)).toBeNull();
  });
});
