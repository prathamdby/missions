import type {
  Settings,
  UpdateSettingsRequest,
} from "@missions/protocol/settings";
import { describe, expect, it } from "vitest";

import { LocationDraft } from "./location-draft";
import {
  DEFAULT_EFFORT,
  selectableModels,
  selectEffort,
  selectModel,
} from "./model-rules";
import { SettingsCoordinator } from "./settings-coordinator";

const initial: Settings = {
  cleanupAfterMerge: false,
  defaultWorkspaceMode: "new_worktree",
  maxConcurrentWorkers: 2,
  orchestrator: { modelId: "planner", reasoningEffort: "high" },
  worker: { modelId: "builder", reasoningEffort: null },
  worktreeRoot: "/worktrees",
};

class FakeSettings {
  value = structuredClone(initial);
  readonly requests: {
    patch: UpdateSettingsRequest;
    result: ReturnType<typeof Promise.withResolvers<undefined>>;
  }[] = [];
  persist = async (patch: UpdateSettingsRequest) => {
    const result = Promise.withResolvers<undefined>();
    this.requests.push({ patch, result });
    await result.promise;
    this.value = { ...this.value, ...patch };
    return this.value;
  };
}

const setup = () => {
  const remote = new FakeSettings();
  const commits: Settings[] = [];
  const errors: unknown[] = [];
  const coordinator = new SettingsCoordinator({
    commit: (value) => commits.push(value),
    onError: (error) => errors.push(error),
    persist: remote.persist,
  });
  return { commits, coordinator, errors, remote };
};

const persist = () => Promise.reject<boolean>(new Error("unexpected"));

describe("settings workflows", () => {
  it("locks synchronously and serializes same-tick controls so responses cannot overwrite newer settings", async () => {
    const { commits, coordinator, remote } = setup();
    const first = coordinator.save({ maxConcurrentWorkers: 3 });
    const second = coordinator.save({ cleanupAfterMerge: true });
    const third = coordinator.save({ maxConcurrentWorkers: 1 });
    expect({
      pending: coordinator.getSnapshot(),
      requests: remote.requests.length,
    }).toStrictEqual({ pending: true, requests: 1 });
    remote.requests[0]?.result.resolve(undefined);
    const savedFirst = await first;
    expect(remote.requests).toHaveLength(2);
    remote.requests[1]?.result.resolve(undefined);
    const savedSecond = await second;
    remote.requests[2]?.result.resolve(undefined);
    const savedThird = await third;
    expect({
      cleanup: commits.at(-1)?.cleanupAfterMerge,
      pending: coordinator.getSnapshot(),
      saved: [savedFirst, savedSecond, savedThird],
      workers: commits.map((entry) => entry.maxConcurrentWorkers),
    }).toStrictEqual({
      cleanup: true,
      pending: false,
      saved: [true, true, true],
      workers: [3, 3, 1],
    });
  });

  it("captures queued nested patches immutably and continues after a failed save", async () => {
    const { commits, coordinator, errors, remote } = setup();
    const first = coordinator.save({ worktreeRoot: "/bad" });
    const model = { modelId: "next", reasoningEffort: null };
    const second = coordinator.save({ worker: model });
    model.modelId = "mutated";
    remote.requests[0]?.result.reject(new Error("not writable"));
    await expect(first).resolves.toBeFalsy();
    expect({ commits, errors }).toStrictEqual({
      commits: [],
      errors: [new Error("not writable")],
    });
    expect(remote.requests[1]?.patch).toStrictEqual({
      worker: { modelId: "next", reasoningEffort: null },
    });
    remote.requests[1]?.result.resolve(undefined);
    await expect(second).resolves.toBeTruthy();
    expect(commits.at(-1)?.worktreeRoot).toBe("/worktrees");
  });

  it("keeps a location draft after failure and closes only after successful retry", async () => {
    const { coordinator, remote } = setup();
    const draft = new LocationDraft();
    draft.edit("  /chosen  ");
    const first = draft.save(initial.worktreeRoot, (value) =>
      coordinator.save({ worktreeRoot: value })
    );
    expect(remote.requests[0]?.patch).toStrictEqual({
      worktreeRoot: "/chosen",
    });
    remote.requests[0]?.result.reject(new Error("denied"));
    await first;
    expect(draft.getSnapshot()).toStrictEqual({
      pending: false,
      value: "  /chosen  ",
    });
    const retry = draft.save(initial.worktreeRoot, (value) =>
      coordinator.save({ worktreeRoot: value })
    );
    remote.requests[1]?.result.resolve(undefined);
    await retry;
    expect(draft.getSnapshot()).toStrictEqual({ pending: false, value: null });
  });

  it("deduplicates location saves and protects typed or reopened drafts from late success", async () => {
    const { coordinator, remote } = setup();
    const draft = new LocationDraft();
    draft.edit("/chosen");
    const pending = draft.save(initial.worktreeRoot, (value) =>
      coordinator.save({ worktreeRoot: value })
    );
    await draft.save(initial.worktreeRoot, (value) =>
      coordinator.save({ worktreeRoot: value })
    );
    expect(remote.requests).toHaveLength(1);
    draft.cancel();
    draft.edit("/chosen");
    remote.requests[0]?.result.resolve(undefined);
    await pending;
    expect(draft.getSnapshot()).toStrictEqual({
      pending: false,
      value: "/chosen",
    });
    const next = draft.save(initial.worktreeRoot, (value) =>
      coordinator.save({ worktreeRoot: value })
    );
    draft.edit("/new typing");
    remote.requests[1]?.result.resolve(undefined);
    await next;
    expect(draft.getSnapshot().value).toBe("/new typing");
  });

  it("blank and unchanged location drafts never persist and thrown saves keep edits", async () => {
    const draft = new LocationDraft();
    draft.edit(" ");
    await draft.save(initial.worktreeRoot, persist);
    expect(draft.getSnapshot().value).toBe(" ");
    draft.edit(initial.worktreeRoot);
    await draft.save(initial.worktreeRoot, persist);
    expect(draft.getSnapshot().value).toBeNull();
    draft.edit("/next");
    await expect(draft.save(initial.worktreeRoot, persist)).rejects.toThrow(
      "unexpected"
    );
    expect(draft.getSnapshot()).toStrictEqual({
      pending: false,
      value: "/next",
    });
  });

  it("model defaults validate effort support without dropping unknown selected values", () => {
    const model = {
      defaultReasoningEffort: "high" as const,
      displayName: "Next",
      id: "next",
      supportedReasoningEfforts: ["high" as const, "low" as const],
    };
    const models = [model];
    const unknown = { modelId: "unavailable", reasoningEffort: "max" as const };
    expect(
      selectableModels(models, unknown).map((entry) => entry.id)
    ).toStrictEqual(["unavailable", "next"]);
    expect(selectModel(models, "next")).toStrictEqual({
      modelId: "next",
      reasoningEffort: "high",
    });
    expect(
      selectModel([{ ...model, supportedReasoningEfforts: [] }], "next")
        .reasoningEffort
    ).toBeNull();
    expect([
      selectEffort(undefined, unknown, "missing"),
      selectEffort(model, unknown, "low"),
      selectEffort(model, unknown, DEFAULT_EFFORT),
    ]).toStrictEqual([
      unknown,
      { modelId: "unavailable", reasoningEffort: "low" },
      { modelId: "unavailable", reasoningEffort: null },
    ]);
  });
});
