import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { DroidClient, ProcessTransport } from "@factory/droid-sdk/node";
import { ReasoningEffortSchema } from "@missions/protocol/common";
import type { AgentModelSettings } from "@missions/protocol/missions";
import type { ModelList, ModelOption } from "@missions/protocol/settings";

import { badRequest, conflict } from "../lib/app-error";
import { ProcessSupervisor } from "../processes/process-supervisor";
import { MODEL_PROBE_TIMEOUT_MS, withDeadline } from "../sdk/startup";

export type ModelLoader = () => Promise<unknown[]>;

const CACHE_MS = 10 * 60_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * `listModels` needs a Factory API key; a throwaway session reports the
 * models the logged-in CLI actually accepts, so probe with one instead.
 */
type ProbeCleanup = () => Promise<void>;

const probeModels = async (
  droidPath: string,
  probes: Set<ProbeCleanup>
): Promise<unknown[]> => {
  const agentId = `model-probe-${randomUUID()}`;
  const supervisor = new ProcessSupervisor({
    binDir: path.join(os.tmpdir(), `missions-${agentId}`),
    droidPath,
  });
  let client: DroidClient | null = null;
  let closing = false;
  const dispose = async () => {
    closing = true;
    const cooperative = client
      ? withDeadline(
          client.close(),
          1000,
          "Model probe cleanup timed out"
        ).catch(() => null)
      : Promise.resolve();
    try {
      const result = await supervisor.stop(agentId);
      if (!result.stopped) {
        throw new Error("Model discovery process could not be stopped");
      }
    } finally {
      await cooperative;
    }
  };
  probes.add(dispose);
  try {
    const launcher = await supervisor.ensureLauncher();
    if (closing) {
      throw new Error("Model discovery was cancelled");
    }
    const transport = new ProcessTransport({
      cwd: os.tmpdir(),
      droidExecPath: launcher,
      env: supervisor.launchEnv(agentId),
      onSpawned: (child) => supervisor.register(agentId, child),
    });
    client = new DroidClient({
      sessionInitTimeout: MODEL_PROBE_TIMEOUT_MS,
      transport,
    });
    const connecting = transport.connect().finally(async () => {
      if (closing) {
        await dispose();
      }
    });
    await withDeadline(
      connecting,
      MODEL_PROBE_TIMEOUT_MS,
      "Model probe connection timed out"
    );
    const init = await client.initializeSession({
      cwd: os.tmpdir(),
      machineId: "default",
      worktree: false,
    });
    const result: unknown = init.result;
    return isRecord(result) && Array.isArray(result.availableModels)
      ? result.availableModels
      : [];
  } finally {
    await dispose();
    probes.delete(dispose);
  }
};

const effort = (value: unknown) => {
  const parsed = ReasoningEffortSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

export const toModelOption = (raw: unknown): ModelOption | null => {
  if (!(isRecord(raw) && typeof raw.id === "string")) {
    return null;
  }
  const efforts = Array.isArray(raw.supportedReasoningEfforts)
    ? raw.supportedReasoningEfforts
        .map(effort)
        .filter((value) => value !== null)
    : [];
  return {
    defaultReasoningEffort:
      efforts.length === 0 ? null : effort(raw.defaultReasoningEffort),
    displayName: typeof raw.displayName === "string" ? raw.displayName : raw.id,
    id: raw.id,
    supportedReasoningEfforts: efforts,
  };
};

/** Models come from the installed Droid CLI, so options match what sessions accept. */
export class ModelCatalog {
  readonly #load: ModelLoader;
  readonly #probes = new Set<ProbeCleanup>();
  readonly #cancel = new AbortController();
  #closed = false;
  #cache: { at: number; list: ModelList } | null = null;
  #pending: Promise<ModelList> | null = null;

  constructor(droidPath: string, load?: ModelLoader) {
    this.#load = load ?? (() => probeModels(droidPath, this.#probes));
  }

  async list(): Promise<ModelList> {
    if (this.#closed) {
      return { models: [], source: "unavailable" };
    }
    if (this.#cache && Date.now() - this.#cache.at < CACHE_MS) {
      return this.#cache.list;
    }
    this.#pending ??= this.#fetch().finally(() => {
      this.#pending = null;
    });
    return await this.#pending;
  }

  /**
   * Seeds the cache from models a real session reported at initialization,
   * so later resolves need no throwaway discovery process.
   */
  remember(raw: readonly unknown[]) {
    if (this.#closed || raw.length === 0) {
      return;
    }
    const models = raw.map(toModelOption).filter((model) => model !== null);
    if (models.length > 0) {
      this.#cache = { at: Date.now(), list: { models, source: "droid" } };
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#cancel.abort();
    const outcomes = await Promise.allSettled(
      [...this.#probes].map((dispose) => dispose())
    );
    const failures = outcomes
      .filter((outcome) => outcome.status === "rejected")
      .map((outcome) => outcome.reason as unknown);
    if (failures.length > 0) {
      throw new AggregateError(failures, "Model discovery cleanup failed");
    }
  }

  async #fetch(): Promise<ModelList> {
    try {
      const raw = await withDeadline(
        this.#load(),
        MODEL_PROBE_TIMEOUT_MS,
        "Model discovery timed out",
        this.#cancel.signal
      );
      const models = raw.map(toModelOption).filter((model) => model !== null);
      const list: ModelList = { models, source: "droid" };
      this.#cache = { at: Date.now(), list };
      return list;
    } catch {
      return { models: [], source: "unavailable" };
    }
  }

  /** Rejects a model or reasoning effort the CLI does not offer; skipped when the list is unavailable. */
  async validate(choice: AgentModelSettings | undefined, role: string) {
    if (!choice) {
      return;
    }
    const list = await this.list();
    if (list.source === "unavailable") {
      return;
    }
    const model = list.models.find((option) => option.id === choice.modelId);
    if (!model) {
      throw badRequest(`${role} model ${choice.modelId} is not available`);
    }
    if (
      choice.reasoningEffort &&
      !model.supportedReasoningEfforts.includes(choice.reasoningEffort)
    ) {
      throw badRequest(
        `${model.displayName} does not support ${choice.reasoningEffort} reasoning`
      );
    }
  }

  /** Mission changes fail closed: an unavailable catalog is not validation. */
  async resolve(
    choice: AgentModelSettings,
    role: string
  ): Promise<AgentModelSettings> {
    const list = await this.list();
    if (list.source === "unavailable") {
      throw conflict(
        "Droid model discovery is unavailable. Check Droid sign-in and MCP configuration, then retry"
      );
    }
    await this.validate(choice, role);
    const model = list.models.find((option) => option.id === choice.modelId);
    return {
      modelId: choice.modelId,
      reasoningEffort:
        choice.reasoningEffort ?? model?.defaultReasoningEffort ?? null,
    };
  }
}
