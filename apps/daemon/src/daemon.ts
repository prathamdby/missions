import path from "node:path";

import type { Hono } from "hono";

import { createApp } from "./app";
import type { DaemonConfig } from "./config";
import { openDatabase } from "./db/database";
import { OperationJournal } from "./db/journal";
import { Store } from "./db/store";
import { EventLog } from "./events/event-log";
import { ArtifactStore } from "./files/artifact-store";
import { AttachmentStore } from "./files/attachment-store";
import { FileSearch } from "./files/file-search";
import { SharedFiles } from "./files/shared-files";
import { GitService } from "./git/git-service";
import { registerAttachmentRoutes } from "./http/attachment-routes";
import { registerComposerRoutes } from "./http/composer-routes";
import { registerFileRoutes } from "./http/file-routes";
import { registerMissionRoutes } from "./http/mission-routes";
import { registerProjectRoutes } from "./http/project-routes";
import { registerPublishRoutes } from "./http/publish-routes";
import { registerPullRequestRoutes } from "./http/pull-request-routes";
import { registerSystemRoutes } from "./http/system-routes";
import { TimingLog, timingSinksFromEnv } from "./lib/timing";
import type { TimingSink } from "./lib/timing";
import { MissionService } from "./missions/mission-service";
import type { MissionTitleGenerator } from "./missions/title-generator";
import { ProcessRecordRepository } from "./processes/process-record-repository";
import { ProcessSupervisor } from "./processes/process-supervisor";
import { ProjectService } from "./projects/project-service";
import type { RuntimeFactory } from "./runtime/contracts";
import { ComposerCatalog } from "./sdk/composer-catalog";
import { ensureToken } from "./security/token";
import { ModelCatalog } from "./settings/models";
import type { ModelLoader } from "./settings/models";
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
  missions: MissionService;
  publish: GitService;
  supervisor: ProcessSupervisor;
  token: string;
  close: () => Promise<void>;
}

/** The daemon only ever binds loopback; the boundary enforces it. */
const HOST = "127.0.0.1";

export interface DaemonOptions {
  config: DaemonConfig;
  version: string;
  startedAt?: Date;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
  /** Extra in-process timing consumers, e.g. the first-token harness. */
  timingSinks?: TimingSink[];
  /** Test seam: substitutes scripted agents for real Droid sessions. */
  createRuntime?: RuntimeFactory;
  /** Test seam: a scripted GitHub CLI. */
  ghPath?: string;
  /** Test seam: model discovery without spawning Droid. */
  loadModels?: ModelLoader;
  /** Opt-in factory shares the daemon's model catalog with Auto title runs. */
  titleGenerator?:
    | MissionTitleGenerator
    | ((models: ModelCatalog) => MissionTitleGenerator)
    | null;
  /** Events kept per stream before the oldest are pruned. */
  retainEventsPerStream?: number;
}

/** Composition root; startup recovery runs before any route can be served. */
export const createDaemon = async (options: DaemonOptions): Promise<Daemon> => {
  const { config, version } = options;
  const now = options.now ?? (() => new Date());
  const startedAt = options.startedAt ?? now();
  const token = await ensureToken(config.tokenPath);
  const handle = openDatabase(config.dbPath);
  const owners: (() => Promise<void>)[] = [];
  let closing: Promise<void> | null = null;
  const close = () => {
    closing ??= (async () => {
      try {
        const results = await Promise.allSettled(
          owners.map(async (stop) => {
            await stop();
          })
        );
        const errors = results
          .filter((result) => result.status === "rejected")
          .map((result) => result.reason as unknown);
        if (errors.length > 0) {
          throw new AggregateError(errors, "Daemon shutdown failed");
        }
      } finally {
        handle.close();
      }
    })();
    return closing;
  };
  try {
    const store = new Store(handle);
    const log = new EventLog(store, {
      now,
      retainPerStream: options.retainEventsPerStream,
    });
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
    owners.push(() => projects.shutdown());
    const workspaces = new WorkspaceService({
      journal,
      now,
      settings: () => settings.get(),
    });

    const processRecords = new ProcessRecordRepository(store);
    const supervisor = new ProcessSupervisor({
      binDir: config.binDir,
      droidPath: config.droidPath,
      onRecord: (record, agentId) => processRecords.save(record, agentId),
    });
    const artifacts = new ArtifactStore(config.artifactsDir);
    const attachments = new AttachmentStore(config.attachmentsDir, now);
    await attachments.sweepPending();
    const sharedFiles = new SharedFiles(path.join(config.home, "shared"));
    const models = new ModelCatalog(config.droidPath, options.loadModels);
    const composerCatalog = new ComposerCatalog(config.droidPath);
    owners.push(
      () => composerCatalog.close(),
      () => models.close()
    );
    const titleGenerator =
      typeof options.titleGenerator === "function"
        ? options.titleGenerator(models)
        : (options.titleGenerator ?? null);
    if (titleGenerator) {
      owners.push(() => titleGenerator.close());
    }
    const missions = new MissionService({
      artifacts,
      attachments,
      createRuntime: options.createRuntime,
      journal,
      log,
      models,
      now,
      processRecords,
      projects,
      settings,
      sharedFiles,
      store,
      supervisor,
      timing: new TimingLog([
        ...timingSinksFromEnv(options.env),
        ...(options.timingSinks ?? []),
      ]),
      titleGenerator,
      workspaces,
    });
    owners.push(() => missions.shutdown());
    const publish = new GitService({
      ghPath: options.ghPath,
      journal,
      missions,
      settings,
    });
    missions.setGitObserver(async (missionId) => {
      await publish.observeAgentGit(missionId);
    });

    journal.recoverInterrupted();
    projects.recoverCloneJobs();
    await missions.recover();
    log.pruneAll();

    const app = createApp({
      boundary: { port: config.port, token },
      now,
      register: (hono) => {
        registerSystemRoutes(hono, {
          droidPath: config.droidPath,
          log,
          models,
          settings,
          startedAt,
          store,
          url: `http://${HOST}:${config.port}`,
          version,
        });
        registerProjectRoutes(hono, projects);
        registerComposerRoutes(
          hono,
          missions,
          projects,
          new FileSearch(),
          composerCatalog
        );
        registerPullRequestRoutes(hono, store);
        registerMissionRoutes(hono, missions);
        registerAttachmentRoutes(hono, attachments, missions);
        registerFileRoutes(hono, missions, artifacts, sharedFiles);
        registerPublishRoutes(hono, publish);
      },
      startedAt,
      version,
    });

    return {
      app,
      close,
      journal,
      log,
      missions,
      projects,
      publish,
      settings,
      store,
      supervisor,
      token,
      workspaces,
    };
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Daemon startup failed and cleanup failed",
        { cause: cleanupError }
      );
    }
    throw error;
  }
};
