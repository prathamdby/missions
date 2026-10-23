import {
  MissionSchema,
  PullRequestListSchema,
} from "@missions/protocol/missions";
import type { Mission } from "@missions/protocol/missions";
import { routes } from "@missions/protocol/routes";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../app";
import { openDatabase } from "../db/database";
import type { DatabaseHandle } from "../db/database";
import { Store } from "../db/store";
import { registerPullRequestRoutes } from "./pull-request-routes";

const opened: DatabaseHandle[] = [];
const mission = (id: string, updatedAt: string, hasPr = true): Mission =>
  MissionSchema.parse({
    autonomy: "medium",
    createdAt: "2026-01-01T00:00:00.000Z",
    epoch: 0,
    goal: "Ship it",
    id,
    lastError: null,
    orchestrator: { modelId: "model", reasoningEffort: null },
    projectId: "project-one",
    publish: {
      cleanup: "none",
      cleanupReason: null,
      commits: [],
      pr: hasPr
        ? {
            checks: "passing",
            isDraft: false,
            number: 42,
            state: "open",
            updatedAt,
            url: "https://github.com/example/repo/pull/42",
          }
        : null,
      pushedBranch: null,
      remote: null,
    },
    revision: 1,
    status: "completed",
    summary: null,
    title: `Title ${id}`,
    updatedAt,
    worker: { modelId: "model", reasoningEffort: null },
    workspace: null,
  });

const setup = () => {
  const handle = openDatabase(":memory:");
  opened.push(handle);
  const store = new Store(handle);
  const app = createApp({
    boundary: { port: 4317, token: "test-token" },
    register: (hono) => registerPullRequestRoutes(hono, store),
    startedAt: new Date(),
    version: "test",
  });
  const get = () =>
    app.request(routes.pullRequests(), {
      headers: { authorization: "Bearer test-token", host: "127.0.0.1:4317" },
    });
  return { get, store };
};

describe("GET /v2/pull-requests", () => {
  afterEach(() => {
    for (const handle of opened.splice(0)) {
      handle.close();
    }
  });

  it("projects stored PRs without loading mission snapshots, newest first", async () => {
    const { get, store } = setup();
    const older = mission("mission-older", "2026-02-01T00:00:00Z");
    const newer = mission("mission-newer", "2026-02-01T00:00:00.001Z");
    store.putMission(older);
    store.putMission(
      mission("mission-none", "2026-03-01T00:00:00.000Z", false)
    );
    store.putMission(newer);
    const snapshots = vi.spyOn(store, "listAgents");
    const response = await get();
    expect(response.status).toBe(200);
    const body = PullRequestListSchema.parse(await response.json());
    expect(body.pullRequests).toStrictEqual(
      [newer, older].map((current) => ({
        missionId: current.id,
        missionTitle: current.title,
        pr: current.publish.pr,
        projectId: current.projectId,
        updatedAt: current.updatedAt,
      }))
    );
    expect(snapshots).not.toHaveBeenCalled();
  });

  it("returns an empty validated list when no missions have a PR", async () => {
    const { get, store } = setup();
    const empty = await get();
    await expect(empty.json()).resolves.toStrictEqual({
      pullRequests: [],
    });
    store.putMission(
      mission("mission-none", "2026-01-01T00:00:00.000Z", false)
    );
    const noPr = await get();
    expect(PullRequestListSchema.parse(await noPr.json())).toStrictEqual({
      pullRequests: [],
    });
  });

  it("rejects invalid stored PR data instead of returning an off-contract body", async () => {
    const { get, store } = setup();
    const invalid = mission("mission-invalid", "2026-01-01T00:00:00.000Z");
    if (invalid.publish.pr) {
      invalid.publish.pr.number = -1;
    }
    store.putMission(invalid);
    const response = await get();
    expect(response.status).toBe(500);
    expect(
      PullRequestListSchema.safeParse({
        pullRequests: [
          {
            missionId: invalid.id,
            missionTitle: invalid.title,
            pr: invalid.publish.pr,
            projectId: invalid.projectId,
            updatedAt: invalid.updatedAt,
          },
        ],
      }).success
    ).toBeFalsy();
  });
});
