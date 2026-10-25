import type { APIRequestContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";

import { DaemonEventSchema } from "../packages/protocol/src/events";
import type { EventBody } from "../packages/protocol/src/events";
import { SSE_EVENT } from "../packages/protocol/src/http";
import {
  MissionSnapshotSchema,
  TranscriptItemSchema,
} from "../packages/protocol/src/missions";
import type {
  MissionSnapshot,
  TranscriptItem,
} from "../packages/protocol/src/missions";
import {
  addProject,
  createMission,
  gitRepo,
  missionSnapshot,
} from "./fixtures";

export const uiMission = async (request: APIRequestContext, name: string) => {
  const project = await addProject(request, gitRepo(name));
  const mission = await createMission(request, project.id);
  await expect
    .poll(
      async () =>
        MissionSnapshotSchema.parse(await missionSnapshot(request, mission.id))
          .mission.status,
      { timeout: 30_000 }
    )
    .toBe("awaiting_approval");
  const snapshot = MissionSnapshotSchema.parse(
    await missionSnapshot(request, mission.id)
  );
  snapshot.mission.status = "running";
  snapshot.agents = snapshot.agents.map((agent) => ({
    ...agent,
    status: "idle",
    waitingReason: null,
  }));
  snapshot.plans = [];
  snapshot.questions = [];
  snapshot.permissions = [];
  snapshot.transcript = [];
  snapshot.transcriptHasMore = false;
  return snapshot;
};

export const uiItem = (
  snapshot: MissionSnapshot,
  seq: number,
  kind: TranscriptItem["kind"],
  text: string,
  extra: Partial<TranscriptItem> = {}
) =>
  TranscriptItemSchema.parse({
    agentId: snapshot.agents[0]?.id,
    createdAt: new Date(
      Date.parse(snapshot.mission.createdAt) + seq * 1000
    ).toISOString(),
    id: `ui-${seq}`,
    isError: false,
    kind,
    missionId: snapshot.mission.id,
    requestId: null,
    seq,
    text,
    toolName: null,
    toolUseId: null,
    ...extra,
  });

export const mountUI = async (page: Page, snapshot: MissionSnapshot) => {
  MissionSnapshotSchema.parse(snapshot);
  // Real SSE stays connected; controlled events use the same decoder and reducer.
  await page.addInitScript(
    ({ eventName }) => {
      const NativeSource = window.EventSource;
      window.EventSource = class extends NativeSource {
        constructor(url: string | URL, options?: EventSourceInit) {
          super(url, options);
          const missionId = new URL(url, window.location.href).searchParams.get(
            "missionId"
          );
          window.addEventListener("ui-mission-event", (event) => {
            if (
              event instanceof CustomEvent &&
              event.detail.missionId === missionId
            ) {
              this.dispatchEvent(
                new MessageEvent(eventName, {
                  data: JSON.stringify(event.detail),
                  lastEventId: String(event.detail.seq),
                })
              );
            }
          });
        }
      };
    },
    { eventName: SSE_EVENT }
  );
  await page.route(`**/missions/${snapshot.mission.id}/snapshot`, (route) =>
    route.fulfill({ json: snapshot })
  );
  await page.goto(`/missions/${snapshot.mission.id}`);
  await expect(
    page.getByRole("tablist", { name: "Agent conversations" })
  ).toBeVisible();
};

export const emitUI = async (
  page: Page,
  snapshot: MissionSnapshot,
  body: EventBody
) => {
  snapshot.cursor += 1;
  const event = DaemonEventSchema.parse({
    ...body,
    at: new Date().toISOString(),
    missionId: snapshot.mission.id,
    seq: snapshot.cursor,
  });
  await page.evaluate(
    (detail) =>
      window.dispatchEvent(new CustomEvent("ui-mission-event", { detail })),
    event
  );
};

export const populateSidebar = (snapshot: MissionSnapshot) => {
  const [orchestrator] = snapshot.agents;
  if (!orchestrator) {
    throw new Error("Missing Orchestrator");
  }
  snapshot.agents.push(
    ...Array.from({ length: 16 }, (_, index) => ({
      ...orchestrator,
      assignmentId: `assignment-${index}`,
      createdAt: new Date(
        Date.parse(orchestrator.createdAt) + index + 1
      ).toISOString(),
      id: `worker-${index}`,
      role: "worker" as const,
      title: `Worker ${index + 1}`,
    }))
  );
  snapshot.assignments = snapshot.agents.slice(1).map((agent, index) => ({
    createdAt: agent.createdAt,
    epoch: 0,
    handoff: null,
    id: `assignment-${index}`,
    instructions: "Review changes",
    missionId: snapshot.mission.id,
    needsWrite: false,
    status: "running",
    title: `Task ${index + 1}`,
    updatedAt: agent.updatedAt,
    workerAgentId: agent.id,
  }));
  snapshot.todos = Array.from({ length: 80 }, (_, index) => ({
    agentId: orchestrator.id,
    content: `Review item ${index + 1}`,
    id: `todo-${index}`,
    missionId: snapshot.mission.id,
    position: index,
    priority: "medium",
    status: "pending",
  }));
};
