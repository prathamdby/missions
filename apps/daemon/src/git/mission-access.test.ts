import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { ChangesSchema } from "@missions/protocol/files";
import { routes } from "@missions/protocol/routes";
import { describe, expect, expectTypeOf, it } from "vitest";

import type { MissionService } from "../missions/mission-service";
import { gitRepo, sh } from "../test/fixtures";
import { bootDaemon, control, MODEL } from "../test/mission-harness";
import { GitService } from "./git-service";
import type { GitServiceOptions } from "./git-service";
import type { PublishMissionAccess } from "./mission-access";

const broadDependency = (source: string) =>
  /from ["']\.\.\/missions\/mission-service["']/u.test(source);

describe("publishing mission boundary", () => {
  it("commits and recovers cleanup through only the five coordinated access methods", async () => {
    const booted = await bootDaemon([]);
    const { daemon } = booted;
    try {
      const repo = await gitRepo();
      const added = await daemon.projects.addLocal({
        operationId: "narrow-project",
        path: repo,
      });
      if (added.status !== "added") {
        throw new Error("project not added");
      }
      const snapshot = await daemon.missions.create({
        goal: "Add a greeting",
        operationId: "narrow-mission",
        orchestrator: MODEL,
        projectId: added.project.id,
        worker: MODEL,
        workspace: { baseBranch: "main", mode: "new_worktree" },
      });
      const missionId = snapshot.mission.id;
      const { workspace } = snapshot.mission;
      if (!workspace) {
        throw new Error("workspace not created");
      }
      await daemon.missions.pause(
        missionId,
        control(daemon, missionId, "narrow-pause")
      );
      const coordination: string[] = [];
      const accessed = new Set<PropertyKey>();
      const forbidden: PropertyKey[] = [];
      let coordinated = false;
      let interrupted = false;
      const access: PublishMissionAccess = {
        get: (id) => daemon.missions.get(id),
        notify: (id, code, level, message) =>
          daemon.missions.notify(id, code, level, message),
        patch: (id, change) => {
          expect(coordinated).toBeTruthy();
          const result = daemon.missions.patch(id, change);
          if (!interrupted && result.publish.cleanup === "removed") {
            interrupted = true;
            throw new Error("Interrupted after cleanup metadata");
          }
          return result;
        },
        withWorkspaceMutation: (id, effect) =>
          daemon.missions.withWorkspaceMutation(id, async () => {
            coordination.push("mutation");
            coordinated = true;
            try {
              return await effect();
            } finally {
              coordinated = false;
            }
          }),
        withWorkspaceRecovery: (id, operationId, effect) =>
          daemon.missions.withWorkspaceRecovery(id, operationId, async () => {
            coordination.push("recovery");
            coordinated = true;
            try {
              return await effect();
            } finally {
              coordinated = false;
            }
          }),
      };
      const missions = new Proxy(access, {
        get: (target, key) => {
          switch (key) {
            case "get":
            case "patch":
            case "notify":
            case "withWorkspaceMutation":
            case "withWorkspaceRecovery": {
              accessed.add(key);
              return target[key];
            }
            default: {
              forbidden.push(key);
              throw new Error(`Unexpected mission capability: ${String(key)}`);
            }
          }
        },
      });
      expect(() => Reflect.get(missions, "pause")).toThrow(
        "Unexpected mission capability: pause"
      );
      const publish = new GitService({
        journal: daemon.journal,
        missions,
        settings: daemon.settings,
      });
      await writeFile(path.join(workspace.path, "greeting.txt"), "hello\n");
      const response = await daemon.app.request(routes.changes(missionId), {
        headers: {
          authorization: `Bearer ${daemon.token}`,
          host: `127.0.0.1:${booted.config.port}`,
        },
      });
      const review = ChangesSchema.parse(await response.json());
      const committed = await publish.commit(missionId, {
        expectedChangesHash: review.hash,
        expectedHead: review.head,
        message: "Add greeting",
        operationId: "narrow-commit",
      });
      expect(committed.publish.commits).toHaveLength(1);
      expect(sh(workspace.path, ["show", "HEAD:greeting.txt"])).toBe("hello");

      await expect(
        publish.cleanup(missionId, {
          action: "remove",
          operationId: "narrow-recovery",
        })
      ).rejects.toThrow("Interrupted after cleanup metadata");
      const recovered = await publish.cleanup(missionId, {
        action: "keep",
        operationId: "narrow-recovery",
      });
      expect({
        accessed,
        cleanup: recovered.publish.cleanup,
        coordination,
        forbidden,
        receipt: daemon.journal.get("narrow-recovery")?.operation.status,
        retained: sh(repo, ["show", `${workspace.branch}:greeting.txt`]),
        status: recovered.status,
        workspaceExists: existsSync(workspace.path),
      }).toStrictEqual({
        accessed: new Set([
          "get",
          "patch",
          "withWorkspaceMutation",
          "withWorkspaceRecovery",
        ]),
        cleanup: "removed",
        coordination: ["mutation", "mutation", "recovery"],
        forbidden: ["pause"],
        receipt: "reconciled",
        retained: "hello",
        status: "archived",
        workspaceExists: false,
      });
    } finally {
      await daemon.close();
    }
  });

  it("rejects the broad dependency and permits the publishing interface", () => {
    expect(
      broadDependency(
        'import type { MissionService } from "../missions/mission-service";'
      )
    ).toBeTruthy();
    expect(
      broadDependency(
        'import type { PublishMissionAccess } from "./mission-access";'
      )
    ).toBeFalsy();
  });

  it("gives GitService only the five existing publishing methods", async () => {
    const source = await readFile(
      path.join(import.meta.dirname, "git-service.ts"),
      "utf-8"
    );
    expect(broadDependency(source)).toBeFalsy();
    expectTypeOf<
      GitServiceOptions["missions"]
    >().toEqualTypeOf<PublishMissionAccess>();
    expectTypeOf<PublishMissionAccess>().toEqualTypeOf<
      Pick<
        MissionService,
        | "get"
        | "patch"
        | "notify"
        | "withWorkspaceMutation"
        | "withWorkspaceRecovery"
      >
    >();
    expectTypeOf<keyof PublishMissionAccess>().toEqualTypeOf<
      | "get"
      | "patch"
      | "notify"
      | "withWorkspaceMutation"
      | "withWorkspaceRecovery"
    >();
  });
});
