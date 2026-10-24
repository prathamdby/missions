import { EVENTS_PATH } from "@missions/protocol/events";
import { routes } from "@missions/protocol/routes";
import {
  ConnectionStatusSchema,
  GrantListSchema,
  ModelListSchema,
  SettingsSchema,
  UpdateSettingsRequestSchema,
} from "@missions/protocol/settings";
import type { ConnectionStatus } from "@missions/protocol/settings";
import type { Hono } from "hono";

import type { Store } from "../db/store";
import type { EventLog } from "../events/event-log";
import { eventStream } from "../events/sse";
import { notFound } from "../lib/app-error";
import { run } from "../lib/exec";
import { githubAuth } from "../projects/project-service";
import type { ModelCatalog } from "../settings/models";
import type { SettingsService } from "../settings/settings-service";
import { param, parseBody, reply } from "./json";

export interface SystemDeps {
  store: Store;
  log: EventLog;
  settings: SettingsService;
  models: ModelCatalog;
  droidPath: string;
  url: string;
  version: string;
  startedAt: Date;
}

const versionOf = async (file: string, args: string[]) => {
  const result = await run(file, args, { timeoutMs: 10_000 });
  return {
    missing: result.missing,
    ok: result.ok,
    text: result.ok ? (result.stdout.trim().split("\n")[0] ?? null) : null,
  };
};

const connection = async (deps: SystemDeps): Promise<ConnectionStatus> => {
  const [droid, gitVersion, github] = await Promise.all([
    versionOf(deps.droidPath, ["--version"]),
    versionOf("git", ["--version"]),
    githubAuth(),
  ]);
  let droidState: ConnectionStatus["droid"]["state"] = "error";
  if (droid.ok) {
    droidState = "ready";
  } else if (droid.missing) {
    droidState = "missing";
  }
  return {
    daemon: {
      startedAt: deps.startedAt.toISOString(),
      url: deps.url,
      version: deps.version,
    },
    droid: {
      message: droid.ok ? null : `Droid CLI not usable at ${deps.droidPath}`,
      state: droidState,
      version: droid.text,
    },
    git: { version: gitVersion.text },
    github: { message: github.message, state: github.state, user: github.user },
  };
};

export const registerSystemRoutes = (app: Hono, deps: SystemDeps) => {
  app.get(EVENTS_PATH, (c) =>
    eventStream(c, deps.log, (id) => deps.store.getMission(id) !== null)
  );
  app.get(routes.settings(), (c) =>
    reply(c, SettingsSchema, deps.settings.get())
  );
  app.patch(routes.settings(), async (c) => {
    const body = await parseBody(c, UpdateSettingsRequestSchema);
    await deps.models.validate(body.orchestrator, "Orchestrator");
    await deps.models.validate(body.worker, "Worker");
    return reply(c, SettingsSchema, deps.settings.update(body));
  });
  app.get(routes.models(), async (c) =>
    reply(c, ModelListSchema, await deps.models.list())
  );
  app.get(routes.grants(), (c) =>
    reply(c, GrantListSchema, { grants: deps.store.listGrants() })
  );
  app.delete(routes.grant(":grantId"), (c) => {
    if (!deps.store.deleteGrant(param(c, "grantId"))) {
      throw notFound("Grant");
    }
    return c.body(null, 204);
  });
  app.get(routes.connection(), async (c) =>
    reply(c, ConnectionStatusSchema, await connection(deps))
  );
};
