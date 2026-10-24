import path from "node:path";

import { describe, expect, it } from "vitest";

import { openDatabase } from "../db/database";
import { Store } from "../db/store";
import { EventLog } from "../events/event-log";
import { tempDir } from "../test/fixtures";
import { defaultSettings, SettingsService } from "./settings-service";

const config = { defaultWorktreeRoot: "/tmp/missions-worktrees" };

const open = (file: string) => {
  const handle = openDatabase(file);
  const store = new Store(handle);
  const service = new SettingsService(
    store,
    new EventLog(store),
    defaultSettings(config as Parameters<typeof defaultSettings>[0], {})
  );
  return { handle, service, store };
};

const LEGACY_SETTINGS = {
  cleanupAfterMerge: true,
  defaultAutonomy: "high",
  maxConcurrentWorkers: 3,
  orchestrator: { modelId: "m", reasoningEffort: null },
  worker: { modelId: "m", reasoningEffort: null },
  worktreeRoot: "/tmp/legacy-worktrees",
};

describe(SettingsService, () => {
  it("defaults a legacy payload without a workspace mode to a new worktree", async () => {
    const file = path.join(await tempDir("settings"), "missions.db");
    const first = open(file);
    first.store.putSetting("app", LEGACY_SETTINGS);
    expect(first.service.get()).toMatchObject({
      defaultWorkspaceMode: "new_worktree",
      maxConcurrentWorkers: 3,
    });
    expect(first.service.get()).not.toHaveProperty("defaultAutonomy");
    first.handle.close();
  });

  it("keeps the default workspace mode across a restart", async () => {
    const file = path.join(await tempDir("settings"), "missions.db");
    const first = open(file);
    first.store.putSetting("app", LEGACY_SETTINGS);
    first.service.update({ defaultWorkspaceMode: "current_checkout" });
    first.handle.close();

    const second = open(file);
    expect(second.service.get()).toMatchObject({
      defaultWorkspaceMode: "current_checkout",
      worktreeRoot: "/tmp/legacy-worktrees",
    });
    expect(second.store.getSetting("app")).not.toHaveProperty(
      "defaultAutonomy"
    );
    second.handle.close();
  });

  it("rejects an unknown workspace mode", () => {
    const { handle, service } = open(":memory:");
    expect(() =>
      service.update({
        defaultWorkspaceMode: "elsewhere" as "new_worktree",
      })
    ).toThrow("defaultWorkspaceMode");
    expect(service.get().defaultWorkspaceMode).toBe("new_worktree");
    handle.close();
  });
});
