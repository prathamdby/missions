import type {
  AnswerQuestionRequest,
  ChangeQueueModeRequest,
  CleanupRequest,
  CommitRequest,
  CreatePullRequest,
  DecidePermissionRequest,
  DecidePlanRequest,
  EditQueueItemRequest,
  EditQueueItemResponse,
  MissionControlRequest,
  PushRequest,
  SubmitMessageRequest,
  UpdateMissionRequest,
} from "@missions/protocol/commands";
import type {
  Mission,
  PermissionRequest,
  PlanRevision,
  Question,
  QueueItem,
} from "@missions/protocol/missions";

import { OperationIntents, operationIntentKey } from "../api/operation-intents";
import type { ModelRole } from "./model-settings";

type WithoutOperation<T> = Omit<T, "operationId">;

export interface MissionCommandInputs {
  archive: WithoutOperation<MissionControlRequest>;
  cleanup: WithoutOperation<CleanupRequest>;
  commit: WithoutOperation<CommitRequest>;
  editQueue: WithoutOperation<EditQueueItemRequest> & { itemId: string };
  message: WithoutOperation<SubmitMessageRequest>;
  pause: WithoutOperation<MissionControlRequest>;
  permission: DecidePermissionRequest & { requestId: string };
  plan: DecidePlanRequest;
  pullRequest: WithoutOperation<CreatePullRequest>;
  push: WithoutOperation<PushRequest>;
  question: AnswerQuestionRequest & { questionId: string };
  queueMode: ChangeQueueModeRequest & { itemId: string };
  removeQueue: { expectedRevision: number; itemId: string };
  resume: WithoutOperation<MissionControlRequest>;
  update: UpdateMissionRequest;
}

export interface MissionCommandResults {
  archive: Mission;
  cleanup: Mission;
  commit: Mission;
  editQueue: EditQueueItemResponse;
  message: QueueItem;
  pause: Mission;
  permission: PermissionRequest;
  plan: PlanRevision;
  pullRequest: Mission;
  push: Mission;
  question: Question;
  queueMode: QueueItem;
  removeQueue: QueueItem;
  resume: Mission;
  update: Mission;
}

export type MissionCommandKind = keyof MissionCommandInputs;
export type MissionCommandTransport = {
  [K in MissionCommandKind]: (
    input: MissionCommandInputs[K],
    operationId: string
  ) => Promise<MissionCommandResults[K]>;
};

type ControlAction = "archive" | "pause" | "resume";
const isControl = (kind: MissionCommandKind): kind is ControlAction =>
  kind === "pause" || kind === "resume" || kind === "archive";

/**
 * One mission's commands. Captures complete request values before any await,
 * retains unknown outcomes, and serializes the controls shared by header and
 * banners. Permission cards and per-role model choices share admission across
 * panel mounts too.
 * The transport is the HTTP/reconciliation adapter in production, a fake in tests.
 */
export class MissionCommands {
  private readonly transport: MissionCommandTransport;
  private readonly intents: OperationIntents;
  private readonly missionId: string;
  private readonly listeners = new Set<() => void>();
  private control: ControlAction | null = null;
  private readonly flights = new Map<string, Promise<unknown>>();

  constructor(
    missionId: string,
    transport: MissionCommandTransport,
    intents = new OperationIntents()
  ) {
    this.missionId = missionId;
    this.transport = transport;
    this.intents = intents;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  pendingControl = (): ControlAction | null => this.control;

  pendingModelUpdate = (role: ModelRole): boolean =>
    this.flights.has(`model:${role}`);

  run<K extends MissionCommandKind>(
    kind: K,
    input: MissionCommandInputs[K],
    occurrence?: string
  ): Promise<MissionCommandResults[K]> {
    const body = structuredClone(input);
    const key = operationIntentKey(this.missionId, kind, body, occurrence);
    const lanes = MissionCommands.lanes(kind, body);
    const existing = lanes
      .map((lane) => this.flights.get(lane))
      .find((flight) => flight !== undefined);
    if (existing) {
      // Each shared lane has one result type: Mission or PermissionRequest.
      return existing as Promise<MissionCommandResults[K]>;
    }
    const operationId = this.intents.idFor(key);
    const request = this.deliver(kind, body, operationId, key, lanes);
    for (const lane of lanes) {
      this.flights.set(lane, request);
    }
    if (isControl(kind)) {
      this.control = kind;
    }
    if (lanes.length > 0) {
      this.emit();
    }
    return request;
  }

  private static lanes<K extends MissionCommandKind>(
    kind: K,
    body: MissionCommandInputs[K]
  ): readonly string[] {
    if (isControl(kind)) {
      return ["control"];
    }
    if (kind === "permission" && "requestId" in body) {
      return [`permission:${body.requestId}`];
    }
    const lanes: string[] = [];
    if (kind === "update") {
      if ("orchestrator" in body && body.orchestrator) {
        lanes.push("model:orchestrator");
      }
      if ("worker" in body && body.worker) {
        lanes.push("model:worker");
      }
    }
    return lanes;
  }

  private async deliver<K extends MissionCommandKind>(
    kind: K,
    body: MissionCommandInputs[K],
    operationId: string,
    key: string,
    lanes: readonly string[]
  ): Promise<MissionCommandResults[K]> {
    // Admission must be visible before even a synchronous fake transport runs.
    await Promise.resolve();
    try {
      const result = await this.transport[kind](body, operationId);
      this.intents.settle(key);
      return result;
    } catch (error) {
      this.intents.release(error, key);
      throw error;
    } finally {
      for (const lane of lanes) {
        this.flights.delete(lane);
      }
      if (isControl(kind)) {
        this.control = null;
      }
      if (lanes.length > 0) {
        this.emit();
      }
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
