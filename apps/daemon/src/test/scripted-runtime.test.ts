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

const SUMMARY =
  "Added NOTES.md and reviewed it.\n\nChecks:\n- test -f NOTES.md: passed";

const start = async (goal = "Write notes") => {
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
    goal,
    operationId: "scripted-mission",
    orchestrator: MODEL,
    projectId: added.project.id,
    worker: MODEL,
    workspace: { mode: "current_checkout" },
  });
  return {
    daemon,
    id: created.mission.id,
    initialMode: created.mission.executionMode,
    repo,
  };
};

describe(ScriptedRuntime, () => {
  afterEach(async () => {
    await Promise.all(opened.splice(0).map((daemon) => daemon.close()));
  });

  it(
    "works straight through in Work mode, with assignment and handoff as agent messages",
    { timeout: 20_000 },
    async () => {
      const { daemon, id, repo } = await start();
      const done = await until(
        () => daemon.missions.snapshot(id),
        (snap) => snap.mission.status === "completed"
      );
      const messages = done.transcript.filter(
        (item) => item.kind === "agent_message"
      );
      expect({
        handoffs: done.assignments.map((a) => a.status),
        messages: messages.map((item) => [
          item.purpose,
          item.sender?.role,
          item.recipient?.role,
        ]),
        notes: existsSync(path.join(repo, "NOTES.md")),
        plans: done.plans.length,
        queue: done.queue.map((item) => [item.purpose, item.state]),
        summary: done.mission.summary,
      }).toStrictEqual({
        handoffs: ["handed_off"],
        messages: [
          ["assignment", "orchestrator", "worker"],
          ["handoff", "worker", "orchestrator"],
        ],
        notes: true,
        plans: 0,
        queue: [
          ["message", "sent"],
          ["assignment", "sent"],
          ["handoff", "sent"],
        ],
        summary: SUMMARY,
      });
    }
  );

  it(
    "enters Plan mode from a plain-language goal and completes after native approval",
    { timeout: 20_000 },
    async () => {
      const { daemon, id, repo, initialMode } = await start(
        "Write notes. Plan it first."
      );
      expect(initialMode).toBe("work");
      const proposed = await until(
        () => daemon.missions.snapshot(id),
        (snap) => snap.plans.some((plan) => plan.actionable)
      );
      expect({
        mode: proposed.mission.executionMode,
        notes: existsSync(path.join(repo, "NOTES.md")),
        plans: proposed.plans.map((plan) => [plan.status, plan.actionable]),
        status: proposed.mission.status,
      }).toStrictEqual({
        mode: "plan",
        notes: false,
        plans: [["proposed", true]],
        status: "awaiting_approval",
      });
      daemon.missions.decidePlan(id, { approve: true, planRevision: 1 });
      const done = await until(
        () => daemon.missions.snapshot(id),
        (snap) => snap.mission.status === "completed"
      );
      expect({
        handoffs: done.assignments.map((a) => a.status),
        mode: done.mission.executionMode,
        summary: done.mission.summary,
      }).toStrictEqual({
        handoffs: ["handed_off"],
        mode: "work",
        summary: SUMMARY,
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
