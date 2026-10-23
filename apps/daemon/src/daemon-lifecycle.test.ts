import { ChildProcess } from "node:child_process";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createDaemon } from "./daemon";
import type { Daemon } from "./daemon";
import * as database from "./db/database";
import type { DatabaseHandle } from "./db/database";
import { MissionService } from "./missions/mission-service";
import { ProjectService } from "./projects/project-service";
import { testConfig } from "./test/fixtures";

const opened: Daemon[] = [];

const start = async () => {
  const daemon = await createDaemon({
    config: await testConfig(),
    version: "test",
  });
  opened.push(daemon);
  return daemon;
};

describe("daemon resource lifetime", () => {
  afterEach(async () => {
    await Promise.allSettled(opened.splice(0).map((daemon) => daemon.close()));
    vi.restoreAllMocks();
  });

  it("shares repeated close and drains project work before closing persistence", async () => {
    const daemon = await start();
    const { promise, resolve } = Promise.withResolvers<undefined>();
    const shutdown = vi
      .spyOn(daemon.projects, "shutdown")
      .mockImplementation(async () => {
        await promise;
        daemon.store.putSetting("clone-drained", true);
      });
    const missions = vi.spyOn(daemon.missions, "shutdown");
    const closing = daemon.close();
    expect(daemon.close()).toBe(closing);
    // Persistence remains usable until the owned clone job has finished.
    daemon.store.putSetting("still-open", true);
    expect(daemon.store.getSetting("still-open")).toBeTruthy();
    resolve(undefined);
    await closing;
    await daemon.close();
    expect([
      shutdown.mock.calls.length,
      missions.mock.calls.length,
    ]).toStrictEqual([1, 1]);
    expect(() => daemon.store.getSetting("still-open")).toThrow(/not open/u);
  });

  it("still drains other owners and closes SQLite when one shutdown fails", async () => {
    const daemon = await start();
    const { promise, resolve } = Promise.withResolvers<undefined>();
    vi.spyOn(daemon.projects, "shutdown").mockImplementation(async () => {
      await promise;
      daemon.store.putSetting("drained-after-error", true);
    });
    vi.spyOn(daemon.missions, "shutdown").mockRejectedValue(
      new Error("stop failed")
    );
    const closing = daemon.close();
    // Attach rejection handling immediately while the other owner drains.
    const observed = Promise.allSettled([closing]);
    await Promise.resolve();
    daemon.store.putSetting("not-closed-early", true);
    resolve(undefined);
    const results = await observed;
    expect(results).toMatchObject([
      { reason: { message: "Daemon shutdown failed" }, status: "rejected" },
    ]);
    expect(() => daemon.store.getSetting("not-closed-early")).toThrow(
      /not open/u
    );
    expect(daemon.close()).toBe(closing);
  });

  it("releases acquired projects, missions and SQLite after startup recovery fails", async () => {
    const handles: DatabaseHandle[] = [];
    const order: string[] = [];
    const original = database.openDatabase;
    vi.spyOn(database, "openDatabase").mockImplementation((file) => {
      const handle = original(file);
      handles.push(handle);
      const { close } = handle;
      handle.close = () => {
        order.push("database");
        close();
      };
      return handle;
    });
    vi.spyOn(MissionService.prototype, "recover").mockRejectedValue(
      new Error("recovery failed")
    );
    vi.spyOn(ProjectService.prototype, "shutdown").mockImplementation(() => {
      order.push("projects");
      return Promise.resolve();
    });
    vi.spyOn(MissionService.prototype, "shutdown").mockImplementation(() => {
      order.push("missions");
      return Promise.resolve();
    });
    await expect(
      createDaemon({ config: await testConfig(), version: "test" })
    ).rejects.toThrow("recovery failed");
    expect(order).toStrictEqual(["projects", "missions", "database"]);
    expect(handles).toHaveLength(1);
    expect(handles[0]?.sqlite.open).toBeFalsy();
  });

  it("records process ownership independently of mission orchestration", async () => {
    const daemon = await start();
    const child = Object.assign(new ChildProcess(), { pid: 987_654_321 });
    daemon.supervisor.launchEnv("agent-unattached");
    daemon.supervisor.register("agent-unattached", child);
    expect(daemon.store.getSetting("process:agent-unattached")).toMatchObject({
      agentId: "agent-unattached",
      pid: child.pid,
      startTime: "",
    });
  });
});
