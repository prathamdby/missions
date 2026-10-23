import path from "node:path";

import type {
  Settings,
  UpdateSettingsRequest,
} from "@missions/protocol/settings";
import { SettingsSchema } from "@missions/protocol/settings";

import type { DaemonConfig } from "../config";
import { expandHome } from "../config";
import type { Store } from "../db/store";
import type { EventLog } from "../events/event-log";
import { badRequest } from "../lib/app-error";

const KEY = "app";

export const defaultSettings = (
  config: DaemonConfig,
  env: NodeJS.ProcessEnv = process.env
): Settings => {
  const modelId = env.MISSIONS_DEFAULT_MODEL ?? "gpt-6-sol";
  return {
    cleanupAfterMerge: false,
    defaultAutonomy: "medium",
    maxConcurrentWorkers: 2,
    orchestrator: { modelId, reasoningEffort: null },
    worker: { modelId, reasoningEffort: null },
    worktreeRoot: config.defaultWorktreeRoot,
  };
};

export class SettingsService {
  readonly #store: Store;
  readonly #log: EventLog;
  readonly #defaults: Settings;

  constructor(store: Store, log: EventLog, defaults: Settings) {
    this.#store = store;
    this.#log = log;
    this.#defaults = defaults;
  }

  get(): Settings {
    const saved = this.#store.getSetting<Partial<Settings>>(KEY) ?? {};
    const merged = SettingsSchema.safeParse({ ...this.#defaults, ...saved });
    return merged.success ? merged.data : this.#defaults;
  }

  update(request: UpdateSettingsRequest): Settings {
    const next: Settings = { ...this.get(), ...request };
    if (request.worktreeRoot !== undefined) {
      const expanded = expandHome(request.worktreeRoot.trim());
      // A relative path would resolve against the daemon's own directory.
      if (!path.isAbsolute(expanded)) {
        throw badRequest(
          "Use a full path for the worktree folder, like ~/code/worktrees"
        );
      }
      const root = path.resolve(expanded);
      if (root === path.parse(root).root) {
        throw badRequest("Choose a specific folder for mission worktrees");
      }
      next.worktreeRoot = root;
    }
    const settings = SettingsSchema.parse(next);
    this.#log.commit((emit) => {
      this.#store.putSetting(KEY, settings);
      emit(null, { data: { settings }, type: "settings.updated" });
    });
    return settings;
  }
}
