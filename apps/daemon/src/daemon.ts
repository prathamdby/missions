import type { Hono } from "hono";

import { createApp } from "./app";
import type { DaemonConfig } from "./config";
import { openDatabase } from "./db/database";
import { OperationJournal } from "./db/journal";
import { Store } from "./db/store";
import { EventLog } from "./events/event-log";
import { registerProjectRoutes } from "./http/project-routes";
import { registerSystemRoutes } from "./http/system-routes";
import { ProjectService } from "./projects/project-service";
import { ensureToken } from "./security/token";
import { defaultSettings, SettingsService } from "./settings/settings-service";
import { WorkspaceService } from "./workspaces/workspace-service";

export interface Daemon {
  app: Hono;
  store: Store;
  log: EventLog;
  journal: OperationJournal;
  projects: ProjectService;
  settings: SettingsService;
  workspaces: WorkspaceService;
  token: string;
  close: () => Promise<void>;
}

export interface DaemonOptions {
  config: DaemonConfig;
  version: string;
  startedAt?: Date;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
}

/** Composition root; startup recovery runs before any route can be served. */
export const createDaemon = async (options: DaemonOptions): Promise<Daemon> => {
  const { config, version } = options;
  const now = options.now ?? (() => new Date());
  const startedAt = options.startedAt ?? now();
  const token = await ensureToken(config.tokenPath);
  const handle = openDatabase(config.dbPath);
  const store = new Store(handle);
  const log = new EventLog(store, { now });
  const journal = new OperationJournal(store, log, now);
  const settings = new SettingsService(
    store,
    log,
    defaultSettings(config, options.env)
  );
  const projects = new ProjectService({
    journal,
    log,
    now,
    reposDir: config.reposDir,
    store,
  });
  const workspaces = new WorkspaceService({
    journal,
    now,
    settings: () => settings.get(),
  });

  journal.recoverInterrupted();
  projects.recoverCloneJobs();
  log.prune(null);

  const app = createApp({
    boundary: { port: config.port, token },
    now,
    register: (hono) => {
      registerSystemRoutes(hono, {
        droidPath: config.droidPath,
        log,
        settings,
        startedAt,
        store,
        version,
      });
      registerProjectRoutes(hono, projects);
    },
    startedAt,
    version,
  });

  return {
    app,
    close: async () => {
      handle.close();
      await Promise.resolve();
    },
    journal,
    log,
    projects,
    settings,
    store,
    token,
    workspaces,
  };
};
