import { afterEach, describe, expect, it, vi } from "vitest";

import * as database from "./db/database";
import type { DatabaseHandle } from "./db/database";
import { MissionService } from "./missions/mission-service";
import { ProjectService } from "./projects/project-service";
import { tempDir } from "./test/fixtures";

const mocks = vi.hoisted(() => ({
  serve: vi.fn<() => never>(),
}));

vi.mock(import("@hono/node-server"), () => ({ serve: mocks.serve }));

describe("daemon entry point", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("releases the daemon if HTTP server construction fails", async () => {
    vi.stubEnv("MISSIONS_SCRIPTED_AGENTS", "0");
    vi.stubEnv("MISSIONS_HOME", await tempDir("entry-point"));
    const handles: DatabaseHandle[] = [];
    const original = database.openDatabase;
    vi.spyOn(database, "openDatabase").mockImplementation((file) => {
      const handle = original(file);
      handles.push(handle);
      return handle;
    });
    const projects = vi.spyOn(ProjectService.prototype, "shutdown");
    const missions = vi.spyOn(MissionService.prototype, "shutdown");
    mocks.serve.mockImplementation(() => {
      throw new Error("server could not start");
    });
    await expect(import("./main")).rejects.toThrow("server could not start");
    expect([
      projects.mock.calls.length,
      missions.mock.calls.length,
    ]).toStrictEqual([1, 1]);
    expect(handles).toHaveLength(1);
    expect(handles[0]?.sqlite.open).toBeFalsy();
  });
});
