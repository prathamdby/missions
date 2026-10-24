import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  ComposerCatalogSchema,
  FileMatchListSchema,
} from "@missions/protocol/composer";
import { routes } from "@missions/protocol/routes";
import { afterEach, describe, expect, it } from "vitest";

import type { Daemon } from "../daemon";
import { bootDaemon, startMission } from "../test/mission-harness";

const opened: Daemon[] = [];

describe("composer routes", () => {
  afterEach(async () => {
    await Promise.all(opened.splice(0).map((daemon) => daemon.close()));
  });

  it("returns workspace-relative paths for projects and missions", async () => {
    const ctx = await startMission(await bootDaemon(opened));
    await mkdir(path.join(ctx.repo, "src"));
    await writeFile(path.join(ctx.repo, "src/settings-view.tsx"), "settings");
    const headers = {
      authorization: `Bearer ${ctx.daemon.token}`,
      host: `127.0.0.1:${ctx.config.port}`,
    };
    const responses = await Promise.all([
      ctx.daemon.app.request(
        `${routes.missionFileSearch(ctx.missionId)}?q=sett`,
        { headers }
      ),
      ctx.daemon.app.request(
        `${routes.projectFileSearch(ctx.projectId)}?q=sett`,
        { headers }
      ),
    ]);
    const results = await Promise.all(
      responses.map(async (response) => ({
        body: FileMatchListSchema.parse(await response.json()),
        status: response.status,
      }))
    );
    expect(results).toStrictEqual(
      Array.from({ length: 2 }, () => ({
        body: { matches: [{ kind: "file", path: "src/settings-view.tsx" }] },
        status: 200,
      }))
    );
  });

  it("shares a ready orchestrator catalog across mission and project routes", async () => {
    const ctx = await startMission(await bootDaemon(opened));
    ctx.orchestrator.skills.push({
      description: "Review changes",
      name: "review",
    });
    ctx.orchestrator.commands.push({
      description: "Inspect changes",
      name: "inspect",
    });
    const headers = {
      authorization: `Bearer ${ctx.daemon.token}`,
      host: `127.0.0.1:${ctx.config.port}`,
    };
    const replies = await Promise.all([
      ctx.daemon.app.request(routes.missionComposerCatalog(ctx.missionId), {
        headers,
      }),
      ctx.daemon.app.request(routes.projectComposerCatalog(ctx.projectId), {
        headers,
      }),
    ]);
    const bodies = await Promise.all(
      replies.map(async (response) =>
        ComposerCatalogSchema.parse(await response.json())
      )
    );
    expect(bodies).toStrictEqual(
      Array.from({ length: 2 }, () => ({
        commands: [
          { description: "Inspect changes", kind: "command", name: "inspect" },
          { description: "Review changes", kind: "skill", name: "review" },
        ],
        source: "droid",
      }))
    );
    expect(ctx.daemon.missions.composerRuntime("/unowned")).toBeNull();
  });
});
