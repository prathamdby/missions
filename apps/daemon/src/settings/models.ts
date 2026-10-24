import os from "node:os";

import { ReasoningEffortSchema } from "@missions/protocol/common";
import type { AgentModelSettings } from "@missions/protocol/missions";
import type { ModelList, ModelOption } from "@missions/protocol/settings";

import { badRequest, conflict } from "../lib/app-error";
import { ProbeSessions } from "../sdk/probe-session";
import { MODEL_PROBE_TIMEOUT_MS, withDeadline } from "../sdk/startup";

export type ModelLoader = () => Promise<unknown[]>;

const CACHE_MS = 10 * 60_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

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
  readonly #probes: ProbeSessions;
  readonly #cancel = new AbortController();
  #closed = false;
  #cache: { at: number; list: ModelList } | null = null;
  #pending: Promise<ModelList> | null = null;

  constructor(droidPath: string, load?: ModelLoader) {
    this.#probes = new ProbeSessions(droidPath);
    this.#load =
      load ??
      (() =>
        this.#probes.run(os.tmpdir(), (_client, init) => {
          const result: unknown = init.result;
          return isRecord(result) && Array.isArray(result.availableModels)
            ? result.availableModels
            : [];
        }));
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
    await this.#probes.close();
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
