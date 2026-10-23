import { existsSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import type { AgentModelSettings } from "@missions/protocol/missions";
import { afterEach, describe, expect, it } from "vitest";

import { createDaemon } from "../daemon";
import type { Daemon } from "../daemon";
import { pollUntil } from "../lib/async";
import { gitRepo, testConfig } from "./fixtures";
import { ScriptedRuntime } from "./scripted-runtime";

const MODEL: AgentModelSettings = {
  modelId: "scripted",
  reasoningEffort: null,
};
const opened: Daemon[] = [];

const until = async <T>(read: () => T, done: (value: T) => boolean) =>
  await pollUntil(() => Promise.resolve(read()), done, Date.now() + 10_000, 10);

describe(ScriptedRuntime, () => {
  afterEach(async () => {
    await Promise.all(opened.splice(0).map((daemon) => daemon.close()));
  });

  it(
    "walks a mission from plan approval to completion",
    { timeout: 20_000 },
    async () => {
      const daemon = await createDaemon({
        config: await testConfig(),
        createRuntime: (options) => new ScriptedRuntime(options, 1),
        version: "test",
      });
      opened.push(daemon);
      const repo = await gitRepo("scripted");
      const added = await daemon.projects.addLocal({
        operationId: "scripted-project",
        path: repo,
      });
      if (added.status !== "added") {
        throw new Error("project not added");
      }
      const created = await daemon.missions.create({
        autonomy: "high",
        goal: "Write notes",
        operationId: "scripted-mission",
        orchestrator: MODEL,
        projectId: added.project.id,
        worker: MODEL,
        workspace: { mode: "current_checkout" },
      });
      const { id } = created.mission;
      const proposed = await until(
        () => daemon.missions.snapshot(id),
        (snap) => snap.mission.status === "awaiting_approval"
      );
      expect(proposed.plans.map((plan) => plan.status)).toStrictEqual([
        "proposed",
      ]);
      await daemon.missions.decidePlan(id, {
        approve: true,
        planRevision: 1,
      });
      const done = await until(
        () => daemon.missions.snapshot(id),
        (snap) => snap.mission.status === "completed"
      );
      expect({
        handoffs: done.assignments.map((a) => a.status),
        notes: existsSync(path.join(repo, "NOTES.md")),
        summary: done.mission.summary,
      }).toStrictEqual({
        handoffs: ["handed_off"],
        notes: true,
        summary:
          "Added NOTES.md and reviewed it.\n\nChecks:\n- test -f NOTES.md: passed",
      });
      const endedAt = done.mission.endedAt ?? "";
      await sleep(5);
      const published = daemon.missions.patch(id, (mission) => ({
        ...mission,
        publish: { ...mission.publish, remote: "origin" },
      }));
      expect({
        ended: Date.parse(endedAt) >= Date.parse(done.mission.createdAt),
        endedAt: published.endedAt,
        movedUpdatedAt: published.updatedAt > endedAt,
      }).toStrictEqual({ ended: true, endedAt, movedUpdatedAt: true });
    }
  );
});
