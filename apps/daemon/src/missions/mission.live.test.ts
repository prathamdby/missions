import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { createDaemon } from "../daemon";
import type { Daemon } from "../daemon";
import { pollUntil } from "../lib/async";
import { gitRepo, testConfig } from "../test/fixtures";

/**
 * End-to-end evidence with real Droid sessions: plan gate, approval, a write
 * in the shared workspace, completion, and pause. Opt-in via `pnpm test:live`.
 */

const MODEL = {
  modelId: process.env.MISSIONS_LIVE_MODEL ?? "glm-5.3-flash",
  reasoningEffort: null,
};
const DROID =
  process.env.MISSIONS_DROID_PATH ??
  path.join(os.homedir(), ".local/bin/droid");
const STEP_MS = 180_000;

const opened: Daemon[] = [];

const waitStatus = async (
  daemon: Daemon,
  missionId: string,
  statuses: string[]
) =>
  await pollUntil(
    () => Promise.resolve(daemon.missions.get(missionId)),
    (mission) => statuses.includes(mission.status),
    Date.now() + STEP_MS,
    500
  );

describe("live mission", () => {
  afterAll(async () => {
    await Promise.all(opened.map((daemon) => daemon.close()));
  });

  it(
    "gates writes on plan approval and finishes in the shared workspace",
    { timeout: STEP_MS * 3 },
    async () => {
      const config = { ...(await testConfig()), droidPath: DROID };
      const daemon = await createDaemon({ config, version: "live" });
      opened.push(daemon);
      const repo = await gitRepo();
      const added = await daemon.projects.addLocal({
        operationId: "live-project-1",
        path: repo,
      });
      if (added.status !== "added") {
        throw new Error("project not added");
      }
      const created = await daemon.missions.create({
        autonomy: "high",
        goal: "Append a line containing exactly `world` to README.md. Keep the plan to one step and do the edit yourself without dispatching Workers. Do not run any commands.",
        operationId: "live-mission-1",
        orchestrator: MODEL,
        projectId: added.project.id,
        worker: MODEL,
        workspace: { mode: "current_checkout" },
      });
      const missionId = created.mission.id;
      const proposed = await waitStatus(daemon, missionId, [
        "awaiting_approval",
        "failed",
        "interrupted",
      ]);
      expect(proposed.status).toBe("awaiting_approval");
      await expect(
        readFile(path.join(repo, "README.md"), "utf-8")
      ).resolves.toBe("hello\n");
      daemon.missions.decidePlan(missionId, { approve: true, planRevision: 1 });
      const orchestratorId = created.agents[0]?.id ?? "";
      await pollUntil(
        () => Promise.resolve(daemon.missions.snapshot(missionId)),
        (snap) =>
          snap.mission.status !== "running" ||
          (snap.agents[0]?.status === "idle" &&
            snap.transcript.some(
              (item) =>
                item.kind === "tool_result" && item.text.includes("world")
            )),
        Date.now() + STEP_MS,
        500
      );
      if (daemon.missions.get(missionId).status === "running") {
        // Models sometimes stop after the edit; a user Steer exercises the message path.
        await daemon.missions.submitMessage(missionId, {
          agentId: orchestratorId,
          mode: "steer",
          operationId: "live-nudge-1",
          text: "The edit is verified. Call missions.complete_mission now.",
        });
      }
      const done = await waitStatus(daemon, missionId, [
        "completed",
        "failed",
        "interrupted",
      ]);
      if (process.env.MISSIONS_LIVE_DEBUG === "1") {
        const snap = daemon.missions.snapshot(missionId);
        process.stdout.write(
          `${JSON.stringify({ agents: snap.agents, permissions: snap.permissions, queue: snap.queue, transcript: snap.transcript.map((i) => [i.kind, i.toolName, i.text.slice(0, 300)]) }, null, 1)}\n`
        );
      }
      expect([
        done.status,
        await readFile(path.join(repo, "README.md"), "utf-8"),
      ]).toStrictEqual(["completed", expect.stringContaining("world")]);
      const paused = await daemon.missions.pause(missionId, {
        expectedRevision: done.revision,
        operationId: "live-pause-1",
      });
      expect(paused.status).toBe("paused");
    }
  );
});
