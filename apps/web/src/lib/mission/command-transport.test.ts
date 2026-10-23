import type { Mission, MissionSnapshot } from "@missions/protocol/missions";
import { afterEach, describe, expect, it, vi } from "vitest";

import { applyEvent, applyLocal, fromSnapshot } from "../live/mission-state";
import { missionCommandTransport } from "./command-transport";
import { MissionCommands } from "./commands";
import { modelSettingsUpdate } from "./model-settings";

const AT = "2026-01-01T00:00:00.000Z";
const mission: Mission = {
  autonomy: "medium",
  createdAt: AT,
  endedAt: null,
  epoch: 0,
  goal: "Keep existing work",
  id: "mission-model",
  lastError: null,
  orchestrator: { modelId: "original", reasoningEffort: "high" },
  projectId: "project",
  publish: {
    cleanup: "none",
    cleanupReason: null,
    commits: [],
    pr: null,
    pushedBranch: null,
    remote: null,
  },
  revision: 4,
  status: "running",
  summary: null,
  title: "Mission",
  updatedAt: AT,
  worker: { modelId: "worker", reasoningEffort: null },
  workspace: null,
};
const snapshot: MissionSnapshot = {
  agents: [],
  artifacts: [],
  assignments: [],
  cursor: 10,
  mission,
  permissions: [],
  plans: [],
  questions: [],
  queue: [],
  todos: [],
  transcript: [],
  transcriptHasMore: false,
};

describe("mission model update transport", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("PATCHes only the mission and reconciles the returned model preference", async () => {
    const worker = { modelId: "new-worker", reasoningEffort: "low" as const };
    const updated = { ...mission, revision: 5, worker };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json(updated));
    vi.stubGlobal("fetch", fetch);
    let live = fromSnapshot(snapshot);
    const commands = new MissionCommands(
      mission.id,
      missionCommandTransport(
        mission.id,
        (entity) => {
          live = applyLocal(live, entity);
        },
        () => Promise.resolve(true)
      )
    );
    await commands.run("update", modelSettingsUpdate("worker", worker, 4));
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/daemon/v1/missions/mission-model");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toStrictEqual({
      expectedRevision: 4,
      worker,
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(live.mission).toStrictEqual(updated);
  });

  it("never overwrites newer SSE settings with an older PATCH response", async () => {
    const reply = Promise.withResolvers<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => reply.promise)
    );
    let live = fromSnapshot(snapshot);
    const transport = missionCommandTransport(
      mission.id,
      (entity) => {
        live = applyLocal(live, entity);
      },
      () => Promise.resolve(true)
    );
    const older = {
      ...mission,
      orchestrator: { modelId: "requested", reasoningEffort: "low" as const },
      revision: 5,
    };
    const newer = {
      ...mission,
      orchestrator: { modelId: "newer", reasoningEffort: "medium" as const },
      revision: 6,
    };
    const pending = transport.update(
      modelSettingsUpdate("orchestrator", older.orchestrator, 4),
      "unused"
    );
    live = applyEvent(live, {
      at: AT,
      data: { mission: newer },
      missionId: mission.id,
      seq: 11,
      type: "mission.updated",
    });
    reply.resolve(Response.json(older));
    await pending;
    expect(live.mission).toStrictEqual(newer);
    live = applyEvent(live, {
      at: AT,
      data: { mission: older },
      missionId: mission.id,
      seq: 12,
      type: "mission.updated",
    });
    expect(live.mission).toStrictEqual(newer);
  });
});
