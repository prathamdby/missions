import type { AgentModelSettings } from "@missions/protocol/missions";

import type { DaemonConfig } from "../config";
import { createDaemon } from "../daemon";
import type { Daemon } from "../daemon";
import { AppError } from "../lib/app-error";
import { pollUntil } from "../lib/async";
import type { ModelLoader } from "../settings/models";
import { FakeRuntime } from "./fake-runtime";
import { gitRepo, testConfig } from "./fixtures";

export const MODEL: AgentModelSettings = {
  modelId: "fake-model",
  reasoningEffort: null,
};

export const RAW_MODELS = ["fake-model", "next-model"].map((id) => ({
  defaultReasoningEffort: "medium",
  id,
  supportedReasoningEfforts: ["low", "medium", "high"],
}));

export interface Booted {
  config: DaemonConfig;
  daemon: Daemon;
  runtimes: FakeRuntime[];
}

/** A daemon with scripted agents; `opened` collects it for teardown. */
export const bootDaemon = async (
  opened: Daemon[],
  config?: DaemonConfig,
  loadModels: ModelLoader = () => Promise.resolve(RAW_MODELS)
): Promise<Booted> => {
  const resolved = config ?? (await testConfig());
  const runtimes: FakeRuntime[] = [];
  const daemon = await createDaemon({
    config: resolved,
    createRuntime: (options) => {
      const runtime = new FakeRuntime(options);
      runtimes.push(runtime);
      return runtime;
    },
    loadModels,
    version: "test",
  });
  opened.push(daemon);
  return { config: resolved, daemon, runtimes };
};

export const waitFor = async <T>(read: () => T, done: (value: T) => boolean) =>
  await pollUntil(() => Promise.resolve(read()), done, Date.now() + 3000, 10);

/** A mission in the current checkout of a fresh repository whose Orchestrator received the goal. */
export const startMission = async (booted: Booted, suffix = "1") => {
  const repo = await gitRepo();
  const added = await booted.daemon.projects.addLocal({
    operationId: `add-project-${suffix}`,
    path: repo,
  });
  if (added.status !== "added") {
    throw new Error("project not added");
  }
  const snapshot = await booted.daemon.missions.create({
    goal: "Add a greeting file",
    operationId: `create-mission-${suffix}`,
    orchestrator: MODEL,
    projectId: added.project.id,
    worker: MODEL,
    workspace: { mode: "current_checkout" },
  });
  const missionId = snapshot.mission.id;
  const orchestrator = await waitFor(
    () =>
      booted.runtimes.find(
        (runtime) =>
          runtime.options.agentId === snapshot.agents[0]?.id &&
          runtime.submitted.length > 0
      ),
    Boolean
  );
  if (!orchestrator) {
    throw new Error("orchestrator not started");
  }
  return {
    ...booted,
    missionId,
    orchestrator,
    projectId: added.project.id,
    repo,
  };
};

/** The current revision with a fresh operation ID. */
export const control = (
  daemon: Daemon,
  missionId: string,
  operationId: string
) => ({
  expectedRevision: daemon.missions.get(missionId).revision,
  operationId,
});

/** A command's status, or `code: message` when it throws, so several outcomes compare in one assertion. */
export const outcome = async (work: () => unknown): Promise<string> => {
  try {
    const value = await work();
    if (typeof value === "object" && value !== null && "status" in value) {
      return String(value.status);
    }
    return "ok";
  } catch (error) {
    if (error instanceof AppError) {
      return `${error.code}: ${error.message}`;
    }
    return error instanceof Error ? error.message : String(error);
  }
};

export const pausedMission = async (booted: Booted, suffix = "1") => {
  const started = await startMission(booted, suffix);
  await started.daemon.missions.pause(
    started.missionId,
    control(started.daemon, started.missionId, `pause-mission-${suffix}`)
  );
  return started;
};
