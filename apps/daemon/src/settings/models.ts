import os from "node:os";

import { DroidClient, ProcessTransport } from "@factory/droid-sdk/node";
import { ReasoningEffortSchema } from "@missions/protocol/common";
import type { AgentModelSettings } from "@missions/protocol/missions";
import type { ModelList, ModelOption } from "@missions/protocol/settings";

import { badRequest } from "../lib/app-error";

export type ModelLoader = () => Promise<unknown[]>;

const CACHE_MS = 10 * 60_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * `listModels` needs a Factory API key; a throwaway session reports the
 * models the logged-in CLI actually accepts, so probe with one instead.
 */
const probeModels = async (droidPath: string): Promise<unknown[]> => {
  const transport = new ProcessTransport({
    cwd: os.tmpdir(),
    droidExecPath: droidPath,
  });
  const client = new DroidClient({ transport });
  try {
    await transport.connect();
    const init = await client.initializeSession({
      cwd: os.tmpdir(),
      machineId: "default",
      worktree: false,
    } as never);
    const result: unknown = init.result;
    return isRecord(result) && Array.isArray(result.availableModels)
      ? result.availableModels
      : [];
  } finally {
    await client.close().catch(() => null);
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
    defaultReasoningEffort: effort(raw.defaultReasoningEffort),
    displayName: typeof raw.displayName === "string" ? raw.displayName : raw.id,
    id: raw.id,
    supportedReasoningEfforts: efforts,
  };
};

/** Models come from the installed Droid CLI, so options match what sessions accept. */
export class ModelCatalog {
  readonly #load: ModelLoader;
  #cache: { at: number; list: ModelList } | null = null;
  #pending: Promise<ModelList> | null = null;

  constructor(droidPath: string, load?: ModelLoader) {
    this.#load = load ?? (() => probeModels(droidPath));
  }

  async list(): Promise<ModelList> {
    if (this.#cache && Date.now() - this.#cache.at < CACHE_MS) {
      return this.#cache.list;
    }
    this.#pending ??= this.#fetch().finally(() => {
      this.#pending = null;
    });
    return await this.#pending;
  }

  async #fetch(): Promise<ModelList> {
    try {
      const raw = await this.#load();
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
      model.supportedReasoningEfforts.length > 0 &&
      !model.supportedReasoningEfforts.includes(choice.reasoningEffort)
    ) {
      throw badRequest(
        `${model.displayName} does not support ${choice.reasoningEffort} reasoning`
      );
    }
  }
}
