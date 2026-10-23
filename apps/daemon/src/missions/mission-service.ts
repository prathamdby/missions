import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { setImmediate as yieldImmediate } from "node:timers/promises";

import type {
  AnswerQuestionRequest,
  ChangeQueueModeRequest,
  CreateMissionRequest,
  DecidePermissionRequest,
  DecidePlanRequest,
  EditQueueItemRequest,
  EditQueueItemResponse,
  MissionControlRequest,
  RetryQueueItemRequest,
  SubmitMessageRequest,
  UpdateMissionRequest,
} from "@missions/protocol/commands";
import {
  AnswerQuestionRequestSchema,
  CreateMissionRequestSchema,
} from "@missions/protocol/commands";
import type {
  DeliveryMode,
  ExecutionMode,
  MessagePurpose,
  Role,
} from "@missions/protocol/common";
import type { EventBody } from "@missions/protocol/events";
import type {
  Agent,
  AgentModelSettings,
  AgentStatus,
  Assignment,
  MessageParty,
  Mission,
  MissionSnapshot,
  PermissionRequest,
  PlanRevision,
  QueueItem,
  Question,
  Todo,
  TranscriptItem,
} from "@missions/protocol/missions";

import type { OperationJournal } from "../db/journal";
import type { Store } from "../db/store";
import type { Emit, EventLog } from "../events/event-log";
import type { ArtifactStore } from "../files/artifact-store";
import type { SharedFiles } from "../files/shared-files";
import { mediaTypeOf, resolveWorkspacePath } from "../files/workspace-files";
import { AppError, conflict, notFound, stale } from "../lib/app-error";
import { errorMessage } from "../lib/async";
import { TimingLog } from "../lib/timing";
import { PermissionBroker } from "../permissions/permission-broker";
import type { AgentContext } from "../permissions/permission-broker";
import { StaleDecisionError } from "../permissions/stale-decision-error";
import { ProcessRecordRepository } from "../processes/process-record-repository";
import type {
  ProcessSupervisor,
  StopResult,
} from "../processes/process-supervisor";
import type { ProjectService } from "../projects/project-service";
import { AgentRuntime } from "../sdk/agent-runtime";
import type {
  AgentEvent,
  AgentRuntimeOptions,
  AskUserAnswer,
  AskUserAsk,
  EditOutcome,
  PermissionToolUse,
  RemoveOutcome,
  RuntimeStartResult,
  SubmitOptions,
} from "../sdk/agent-runtime";
import type { NativeQueueEntry, NativeQueueTracker } from "../sdk/native-queue";
import { nativeTodos } from "../sdk/native-todos";
import { PLAN_GUIDANCE, PLAN_GUIDANCE_VERSION } from "../sdk/plan-guidance";
import { PROMPT_VERSION, promptFor } from "../sdk/prompts";
import {
  createRoleToolServer,
  disabledToolIds,
  enabledToolIds,
  MAIN_RECIPIENT,
  MAX_AGENT_MESSAGE,
  ROLE_TOOL_SERVER,
} from "../sdk/role-tools";
import type {
  HistoryInput,
  RoleToolHandlers,
  SendMessageInput,
  TodoInput,
} from "../sdk/role-tools";
import type { ModelCatalog } from "../settings/models";
import type { SettingsService } from "../settings/settings-service";
import { WorkspaceOperationGate } from "../workspaces/workspace-operation-gate";
import { verifyBinding } from "../workspaces/workspace-service";
import type { WorkspaceService } from "../workspaces/workspace-service";
import { WriteLeaseRegistry } from "../workspaces/write-lease";
import {
  ACTIVE,
  agentMessageText,
  assignmentMessage,
  continuationMessage,
  FENCED,
  ARCHIVABLE,
  handoffMessage,
  isSystemRequest,
  MAX_OUTSTANDING_MESSAGES,
  MAX_PENDING_ASSIGNMENTS,
  planEnteredMessage,
  planRejectedMessage,
  planReissueMessage,
  RESUMABLE,
  resumedMessage,
  resumePhase,
  SNAPSHOT_TRANSCRIPT,
  SYSTEM_PREFIX,
  titleFromGoal,
} from "./messages";
import {
  deliverableFor,
  isOutstanding,
  nextSequence,
  sameMessage,
} from "./outbox";
import {
  agentMessageItem,
  DeltaCoalescer,
  itemsFromMessage,
  textItemId,
  toolCallItem,
  toolItemId,
  toolResultItem,
} from "./transcript";
import type { NewTranscriptItem } from "./transcript";

/** The subset of `AgentRuntime` the service drives; tests substitute a scripted runtime. */
export interface RuntimeHandle {
  readonly queue: NativeQueueTracker;
  readonly sessionId: string | null;
  readonly model: AgentModelSettings | null;
  updateModel: (choice: AgentModelSettings) => Promise<AgentModelSettings>;
  /** Raw model metadata reported at session start; seeds the shared catalog. */
  readonly availableModels?: readonly unknown[];
  start: (resumeSessionId?: string) => Promise<RuntimeStartResult>;
  submit: (
    id: string,
    text: string,
    mode: DeliveryMode,
    options?: SubmitOptions
  ) => Promise<void>;
  /** Model-only context that does not start an agent loop. */
  addContext: (id: string, text: string) => Promise<void>;
  setInteractionMode: (mode: "auto" | "spec") => Promise<void>;
  changeMode: (id: string, mode: DeliveryMode) => Promise<void>;
  remove: (id: string) => Promise<RemoveOutcome>;
  edit: (
    id: string,
    replacementId: string,
    text: string
  ) => Promise<EditOutcome>;
  interrupt: () => Promise<void>;
  close: () => Promise<StopResult>;
}

export type RuntimeFactory = (options: AgentRuntimeOptions) => RuntimeHandle;

export interface MissionServiceOptions {
  store: Store;
  log: EventLog;
  journal: OperationJournal;
  projects: ProjectService;
  workspaces: WorkspaceService;
  settings: SettingsService;
  models: ModelCatalog;
  supervisor: ProcessSupervisor;
  processRecords?: ProcessRecordRepository;
  artifacts: ArtifactStore;
  sharedFiles: SharedFiles;
  createRuntime?: RuntimeFactory;
  now?: () => Date;
  /** Content-free stage timings; disabled unless sinks are configured. */
  timing?: TimingLog;
}

/** Re-reads repository state after an agent-driven Git or PR action. */
export type GitObserver = (missionId: string) => Promise<unknown>;

interface LiveAgent {
  runtime: RuntimeHandle;
  id: string;
  agentId: string;
  missionId: string;
  workspace: string;
  epoch: number;
  phase: "starting" | "ready" | "retiring";
  started: Promise<RuntimeStartResult>;
  ready: Promise<RuntimeHandle>;
  retirement?: Promise<StopResult>;
  toolCalls: Map<string, { name: string; input: Record<string, unknown> }>;
  operations: Set<Promise<unknown>>;
  fenced: PromiseWithResolvers<undefined>;
  /** Planning guidance already supplied to this session. */
  planGuidance: boolean;
  /** Request whose first streamed text has not been timed yet. */
  awaitingText: string | null;
}

/** A live native ExitSpecMode confirmation bound to one plan revision. */
interface PlanBinding {
  live: LiveAgent;
  resolve: (approved: boolean) => void;
}

interface PendingQuestion {
  resolve: (answer: AskUserAnswer) => void;
}

const WRITE_TOOLS = new Set([
  "Edit",
  "Create",
  "ApplyPatch",
  "MultiEdit",
  "Execute",
]);
const PREVIEWABLE = /^(?:image|video)\//u;

const pathInput = (input: Record<string, unknown>) => {
  const value = input.file_path ?? input.filePath ?? input.path;
  return typeof value === "string" ? value : null;
};
const TERMINAL_QUEUE = new Set<QueueItem["state"]>([
  "sent",
  "removed",
  "discarded",
  "failed",
]);
/** Statuses that stop the mission clock; archiving keeps the original end. */
const ENDED_STATUSES = new Set<Mission["status"]>([
  "completed",
  "failed",
  "archived",
]);

const isDefiniteFailure = (error: unknown) => error instanceof AppError;

const isExitSpecMode = (use: PermissionToolUse) =>
  use.confirmationType === "exit_spec_mode" ||
  use.details.type === "exit_spec_mode" ||
  use.toolName === "ExitSpecMode";

/** Recognizable shell Git/PR actions; their effects are re-read afterwards. */
const GIT_ACTION = /(?:^|[\s;&|(`'"])(?:git|gh)\s/u;
const commandOf = (input: Record<string, unknown>) =>
  typeof input.command === "string" ? input.command : "";

/** Upper bound for one read_history entry; the page stays readable. */
const HISTORY_ENTRY_LIMIT = 2000;
const DUPLICATE_OPERATION =
  "This operation ID was already used for another message";
const sameModel = (a: AgentModelSettings, b: AgentModelSettings) =>
  a.modelId === b.modelId && a.reasoningEffort === b.reasoningEffort;

/** Cooperative cleanup only; callers bound it and confirm process shutdown separately. */
const drainNative = async (runtime: RuntimeHandle, signal: AbortSignal) => {
  try {
    await runtime.interrupt();
  } catch {
    // Already idle or disconnected; queue deletion below still runs.
  }
  if (signal.aborted) {
    return;
  }
  const open = runtime.queue
    .list()
    .filter((entry) => !TERMINAL_QUEUE.has(entry.state));
  await Promise.all(
    open.map((entry) => runtime.remove(entry.id).catch(() => "unconfirmed"))
  );
};

/**
 * Coordinates one Orchestrator and bounded Workers per mission. Every agent
 * shares the mission's workspace binding. Delivery stays native: the queue
 * table only mirrors what the SDK runner reported.
 */
export class MissionService {
  readonly #store: Store;
  readonly #log: EventLog;
  readonly #journal: OperationJournal;
  readonly #projects: ProjectService;
  readonly #workspaces: WorkspaceService;
  readonly #settings: SettingsService;
  readonly #models: ModelCatalog;
  readonly #modelUpdates = new Set<string>();
  readonly #supervisor: ProcessSupervisor;
  readonly #processRecords: ProcessRecordRepository;
  readonly #createRuntime: RuntimeFactory;
  readonly #now: () => Date;
  readonly broker: PermissionBroker;
  readonly leases: WriteLeaseRegistry;
  readonly #live = new Map<string, LiveAgent>();
  readonly #questions = new Map<string, PendingQuestion>();
  readonly #deltas: DeltaCoalescer;
  readonly #workspaceGate = new WorkspaceOperationGate();
  readonly #tasks = new Set<Promise<unknown>>();
  #closing = false;
  #shutdownPromise: Promise<void> | null = null;
  readonly #shutdownFailures = new Set<unknown>();
  /** Queue items with a remove or edit in flight; a second change must wait. */
  readonly #queueBusy = new Set<string>();
  readonly #artifacts: ArtifactStore;
  readonly #sharedFiles: SharedFiles;
  readonly #timing: TimingLog;
  /** Live ExitSpecMode confirmations by plan revision ID. */
  readonly #planBindings = new Map<string, PlanBinding>();
  /** Per-recipient delivery loops; `again` reruns after the current pass. */
  readonly #deliveries = new Map<string, { again: boolean }>();
  /** Missions whose main agent asked for Plan mode and must yield first. */
  readonly #planEntries = new Map<string, string | null>();
  #gitObserver: GitObserver | null = null;

  constructor(options: MissionServiceOptions) {
    this.#store = options.store;
    this.#log = options.log;
    this.#journal = options.journal;
    this.#projects = options.projects;
    this.#workspaces = options.workspaces;
    this.#settings = options.settings;
    this.#models = options.models;
    this.#supervisor = options.supervisor;
    this.#processRecords =
      options.processRecords ?? new ProcessRecordRepository(options.store);
    this.#artifacts = options.artifacts;
    this.#sharedFiles = options.sharedFiles;
    this.#createRuntime =
      options.createRuntime ??
      ((runtimeOptions) => new AgentRuntime(runtimeOptions));
    this.#now = options.now ?? (() => new Date());
    this.#timing = options.timing ?? new TimingLog();
    this.leases = new WriteLeaseRegistry((workspace, holder) =>
      this.#onLeaseChange(workspace, holder)
    );
    this.broker = new PermissionBroker({
      acquireWriteLease: (agentId, signal) => {
        const workspace = this.#workspaceOf(agentId);
        if (!workspace) {
          return Promise.reject(new Error("No workspace"));
        }
        return this.#waitingFor(agentId, "write_lease", () =>
          this.leases.acquire(workspace, agentId, signal)
        );
      },
      context: (agentId) => this.#context(agentId),
      now: this.#now,
      roleToolServer: ROLE_TOOL_SERVER,
      store: {
        addGrant: (grant) => {
          this.#store.putGrant(grant);
        },
        listGrants: () => this.#store.listGrants(),
        saveRequest: (request) => this.#savePermission(request),
      },
    });
    this.#deltas = new DeltaCoalescer((itemId, delta) => {
      const agent = this.#store.getAgent(delta.agentId);
      if (agent && this.#isCurrent(agent.id)?.live.id === delta.generation) {
        this.#log.publish(agent.missionId, {
          data: {
            agentId: delta.agentId,
            delta: delta.text,
            kind: delta.kind,
            messageId: itemId,
          },
          type: "transcript.delta",
        });
      }
    });
  }

  #iso() {
    return this.#now().toISOString();
  }

  /** Agent-driven Git actions trigger a repository re-read through this observer. */
  setGitObserver(observer: GitObserver) {
    this.#gitObserver = observer;
  }

  /** Shows why an agent is not producing output while `effect` is pending. */
  async #waitingFor<T>(
    agentId: string,
    reason: NonNullable<Agent["waitingReason"]>,
    effect: () => Promise<T>
  ): Promise<T> {
    this.#setWaiting(agentId, reason);
    try {
      return await effect();
    } finally {
      if (this.#store.getAgent(agentId)?.waitingReason === reason) {
        this.#setWaiting(agentId, null);
      }
    }
  }

  #setWaiting(agentId: string, reason: Agent["waitingReason"]) {
    const agent = this.#store.getAgent(agentId);
    if (agent && agent.waitingReason !== reason && !this.#closing) {
      this.#saveAgent({ ...agent, waitingReason: reason });
    }
  }

  // ---------------------------------------------------------------- reads

  get(id: string): Mission {
    const mission = this.#store.getMission(id);
    if (!mission) {
      throw notFound("Mission");
    }
    return mission;
  }

  list(projectId?: string) {
    return this.#store.listMissions(projectId);
  }

  snapshot(id: string): MissionSnapshot {
    return this.#store.transaction(() => {
      const mission = this.get(id);
      const page = this.#store.transcriptPage(id, null, SNAPSHOT_TRANSCRIPT);
      return {
        agents: this.#store.listAgents(id),
        artifacts: this.#store.artifacts.list(id),
        assignments: this.#store.assignments
          .list(id)
          .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt)),
        cursor: this.#log.bounds(id).latest,
        mission,
        permissions: this.#store.permissions.list(id, ["pending"]),
        plans: this.#store.plans
          .list(id)
          .toSorted((a, b) => a.revision - b.revision),
        questions: this.#store.questions.list(id, ["pending"]),
        queue: this.#store.queue
          .list(id)
          .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt)),
        todos: this.#store.todos
          .list(id)
          .toSorted((a, b) => a.position - b.position),
        transcript: page.items,
        transcriptHasMore: page.hasMore,
      };
    });
  }

  artifact(missionId: string, artifactId: string) {
    const artifact = this.#store.artifacts.get(artifactId);
    if (!artifact || artifact.missionId !== missionId) {
      throw notFound("Artifact");
    }
    return artifact;
  }

  transcript(id: string, before: number | null, limit: number) {
    this.get(id);
    const page = this.#store.transcriptPage(
      id,
      before,
      Math.min(Math.max(limit, 1), 500)
    );
    return {
      items: page.items,
      nextCursor: page.hasMore ? String(page.items[0]?.seq ?? "") : null,
    };
  }

  // -------------------------------------------------------------- writes

  #saveMission(emit: Emit, mission: Mission) {
    const at = this.#iso();
    const next = {
      ...mission,
      endedAt:
        mission.endedAt ?? (ENDED_STATUSES.has(mission.status) ? at : null),
      revision: mission.revision + 1,
      updatedAt: at,
    };
    this.#store.putMission(next);
    emit(next.id, { data: { mission: next }, type: "mission.updated" });
    return next;
  }

  #mutateMission(id: string, change: (mission: Mission) => Mission) {
    return this.#log.commit((emit) =>
      this.#saveMission(emit, change(this.get(id)))
    );
  }

  /** For publishing: applies a change to the stored mission and emits it. */
  patch(id: string, change: (mission: Mission) => Mission) {
    return this.#mutateMission(id, change);
  }

  notify(
    missionId: string,
    code: Extract<EventBody, { type: "notice" }>["data"]["notice"]["code"],
    level: "info" | "warning" | "error",
    message: string
  ) {
    this.#notice(missionId, code, level, message);
  }

  #saveAgent(agent: Agent, emit?: Emit) {
    const next = { ...agent, updatedAt: this.#iso() };
    const write = (e: Emit) => {
      this.#store.putAgent(next);
      e(next.missionId, { data: { agent: next }, type: "agent.updated" });
    };
    if (emit) {
      write(emit);
    } else {
      this.#log.commit(write);
    }
    return next;
  }

  #patchAgent(agentId: string, patch: Partial<Agent>) {
    const agent = this.#store.getAgent(agentId);
    return agent ? this.#saveAgent({ ...agent, ...patch }) : null;
  }

  #publish(missionId: string, body: EventBody) {
    this.#log.publish(missionId, body);
  }

  #notice(
    missionId: string,
    code: Extract<EventBody, { type: "notice" }>["data"]["notice"]["code"],
    level: "info" | "warning" | "error",
    message: string,
    retryAfterMs: number | null = null
  ) {
    this.#publish(missionId, {
      data: { notice: { code, level, message, retryAfterMs } },
      type: "notice",
    });
  }

  #appendTranscript(missionId: string, items: NewTranscriptItem[]) {
    if (items.length === 0) {
      return;
    }
    this.#log.commit((emit) => {
      for (const entry of items) {
        if (this.#store.getTranscriptItem(entry.id)) {
          continue;
        }
        this.#deltas.drop(entry.id);
        const saved: TranscriptItem = this.#store.appendTranscript(entry);
        emit(missionId, { data: { item: saved }, type: "transcript.item" });
      }
    });
  }

  #savePermission(request: PermissionRequest) {
    this.#log.commit((emit) => {
      this.#store.permissions.put(request);
      emit(request.missionId, {
        data: { request },
        type: "permission.updated",
      });
    });
    if (request.agentId && this.#isCurrent(request.agentId)) {
      const pending = request.status === "pending";
      this.#patchAgent(request.agentId, {
        status: pending ? "waiting_permission" : "working",
        waitingReason: pending ? "permission" : null,
      });
    }
  }

  #saveQuestion(question: Question) {
    this.#log.commit((emit) => {
      this.#store.questions.put(question);
      emit(question.missionId, {
        data: { question },
        type: "question.updated",
      });
    });
  }

  #saveAssignment(assignment: Assignment) {
    const next = { ...assignment, updatedAt: this.#iso() };
    this.#log.commit((emit) => {
      this.#store.assignments.put(next);
      emit(next.missionId, {
        data: { assignment: next },
        type: "assignment.updated",
      });
    });
    return next;
  }

  #savePlan(plan: PlanRevision, emit: Emit) {
    this.#store.plans.put(plan);
    emit(plan.missionId, { data: { plan }, type: "plan.updated" });
  }

  #saveQueueItem(item: QueueItem) {
    this.#log.commit((emit) => {
      this.#store.queue.put(item);
      emit(item.missionId, { data: { item }, type: "queue.updated" });
    });
    return item;
  }

  // ------------------------------------------------------- broker context

  #workspaceOf(agentId: string) {
    const owner = this.#live.get(agentId);
    if (owner) {
      return owner.workspace;
    }
    const agent = this.#store.getAgent(agentId);
    const mission = agent ? this.#store.getMission(agent.missionId) : null;
    return mission?.workspace?.path ?? null;
  }

  #context(agentId: string): AgentContext | null {
    const agent = this.#store.getAgent(agentId);
    const mission = agent ? this.#store.getMission(agent.missionId) : null;
    const live = this.#live.get(agentId);
    if (!(agent && mission?.workspace && live)) {
      return null;
    }
    return {
      autonomy: mission.autonomy,
      canWrite:
        agent.role === "orchestrator" ||
        (agent.assignmentId !== null &&
          this.#store.assignments.get(agent.assignmentId)?.needsWrite === true),
      epoch: mission.epoch,
      fenced:
        this.#closing ||
        FENCED.has(mission.status) ||
        live.phase === "retiring" ||
        live.epoch !== mission.epoch,
      missionId: mission.id,
      otherWriters: this.#otherWriters(mission.id, agent.id),
      planMode: mission.executionMode === "plan",
      projectId: mission.projectId,
      role: agent.role,
      workspacePath: mission.workspace.path,
    };
  }

  /** Live writable Workers other than `agentId`; they block repository administration. */
  #otherWriters(missionId: string, agentId: string) {
    return this.#store.assignments
      .list(missionId, ["running"])
      .flatMap((assignment) => {
        const workerId = assignment.workerAgentId;
        if (
          !assignment.needsWrite ||
          !workerId ||
          workerId === agentId ||
          !this.#live.has(workerId)
        ) {
          return [];
        }
        const title = this.#store.getAgent(workerId)?.title ?? "A Worker";
        return [`${title} (${assignment.id})`];
      });
  }

  #onLeaseChange(workspace: string, holder: string | null) {
    for (const mission of this.#store.listMissions()) {
      for (const agent of this.#store.listAgents(mission.id)) {
        if (this.#workspaceOf(agent.id) !== workspace) {
          continue;
        }
        const holdsWriteLease = agent.id === holder;
        if (agent.holdsWriteLease !== holdsWriteLease) {
          this.#saveAgent({ ...agent, holdsWriteLease });
        }
      }
    }
  }

  #workspaceForOperation(missionId: string) {
    this.#requireOpen();
    const { workspace } = this.get(missionId);
    if (!workspace) {
      throw conflict("The mission has no workspace");
    }
    return workspace;
  }

  #requireOpen() {
    if (this.#closing) {
      throw conflict("The daemon is stopping");
    }
  }

  /** Both mutation and recovery exclude every execution owner of the workspace. */
  async #requireWorkspaceQuiescent(canonical: string): Promise<void> {
    this.#requireOpen();
    if ([...this.#live.values()].some((live) => live.workspace === canonical)) {
      throw conflict("Agent execution still owns this workspace");
    }
    const occupiedWorkspaces = this.#store
      .listMissions()
      .flatMap((mission) =>
        (mission.status === "stop_failed" || ACTIVE.has(mission.status)) &&
        mission.workspace
          ? [mission.workspace.path]
          : []
      );
    const occupiedCanonical = await Promise.all(
      occupiedWorkspaces.map((workspace) =>
        realpath(workspace).catch(() => workspace)
      )
    );
    this.#requireOpen();
    if (
      occupiedWorkspaces.includes(canonical) ||
      occupiedCanonical.includes(canonical)
    ) {
      throw conflict("Agent processes still own this workspace");
    }
  }

  #requireCleanupRecovery(missionId: string, operationId: string) {
    const existing = this.#journal.get(operationId, {
      kind: "workspace.cleanup",
      missionId,
    });
    if (
      !existing ||
      (existing.operation.status !== "unknown" &&
        existing.operation.status !== "intent") ||
      existing.operation.detail.action !== "remove"
    ) {
      throw conflict("Only an uncertain workspace removal can be recovered");
    }
  }

  /** Excludes execution admission for the complete external mutation interval. */
  async withWorkspaceMutation<T>(
    missionId: string,
    effect: () => Promise<T>
  ): Promise<T> {
    const workspace = this.#workspaceForOperation(missionId);
    return await this.#own(
      this.#workspaceGate.run(workspace.path, async (canonical) => {
        this.#requireOpen();
        if (!ARCHIVABLE.has(this.get(missionId).status)) {
          throw conflict("Stop the mission before publishing");
        }
        await this.#requireWorkspaceQuiescent(canonical);
        return await effect();
      })
    );
  }

  /** Observe a previously uncertain removal and settle metadata; never initiate deletion. */
  async withWorkspaceRecovery<T>(
    missionId: string,
    operationId: string,
    effect: () => Promise<T>
  ): Promise<T> {
    const workspace = this.#workspaceForOperation(missionId);
    this.#requireCleanupRecovery(missionId, operationId);
    return await this.#own(
      this.#workspaceGate.runRecovery(workspace.path, async (canonical) => {
        await this.#requireWorkspaceQuiescent(canonical);
        // A queued recovery must not replay after another holder settled its intent.
        this.#requireCleanupRecovery(missionId, operationId);
        return await effect();
      })
    );
  }

  #own<T>(task: Promise<T>): Promise<T> {
    this.#tasks.add(task);
    void this.#observeTask(task);
    return task;
  }

  async #observeTask(task: Promise<unknown>): Promise<void> {
    try {
      await task;
    } catch (error) {
      if (this.#closing) {
        this.#shutdownFailures.add(error);
      }
    } finally {
      this.#tasks.delete(task);
    }
  }

  // ------------------------------------------------------------- creation

  create(input: CreateMissionRequest): Promise<MissionSnapshot> {
    if (this.#closing) {
      return Promise.reject(conflict("The daemon is stopping"));
    }
    return this.#own(this.#create(input));
  }

  async #create(input: CreateMissionRequest): Promise<MissionSnapshot> {
    const request = CreateMissionRequestSchema.parse(input);
    const project = this.#projects.get(request.projectId);
    const { result } = await this.#journal.run(
      {
        detail: { projectId: project.id },
        id: request.operationId,
        kind: "mission.create",
        missionId: null,
      },
      async () => {
        const settings = this.#settings.get();
        const id = randomUUID();
        const title = request.title ?? titleFromGoal(request.goal);
        const workspace = await this.#workspaces.bind(
          id,
          project,
          request.workspace,
          request.operationId,
          title
        );
        const at = this.#iso();
        const mission: Mission = {
          autonomy: request.autonomy ?? settings.defaultAutonomy,
          createdAt: at,
          endedAt: null,
          epoch: 0,
          // A Plan request on the goal is an ordered transition applied
          // before the goal is delivered, like any later Plan message.
          executionMode: "work",
          goal: request.goal,
          id,
          lastError: null,
          orchestrator: request.orchestrator ?? settings.orchestrator,
          pendingExecutionMode: null,
          projectId: project.id,
          publish: {
            cleanup: "none",
            cleanupReason: null,
            commits: [],
            pr: null,
            pushedBranch: null,
            remote: null,
          },
          revision: 0,
          status: "running",
          summary: null,
          title,
          updatedAt: at,
          worker: request.worker ?? settings.worker,
          workspace,
        };
        const orchestrator = this.#newAgent(
          mission,
          "orchestrator",
          "Orchestrator",
          null
        );
        const goalItem = this.#newQueueItem({
          agentId: orchestrator.id,
          executionMode: request.executionMode ?? null,
          id: `${mission.id}:goal`,
          missionId: mission.id,
          mode: "steer",
          sequence: 1,
          text: request.goal,
        });
        this.#log.commit((emit) => {
          this.#saveMission(emit, mission);
          this.#saveAgent(orchestrator, emit);
          this.#store.queue.put(goalItem);
          emit(mission.id, { data: { item: goalItem }, type: "queue.updated" });
        });
        return { missionId: id };
      }
    );
    const { missionId } = result as { missionId: string };
    this.#timing.mark(`${missionId}:goal`, "message.accepted", {
      missionId,
    });
    this.#own(this.#launch(missionId));
    return this.snapshot(missionId);
  }

  #newAgent(
    mission: Mission,
    role: Role,
    title: string,
    assignmentId: string | null
  ): Agent {
    const at = this.#iso();
    return {
      assignmentId,
      createdAt: at,
      holdsWriteLease: false,
      id: randomUUID(),
      missionId: mission.id,
      model: role === "orchestrator" ? mission.orchestrator : mission.worker,
      previousSessionIds: [],
      promptVersion: null,
      role,
      sessionGeneration: 0,
      sessionId: null,
      status: "starting",
      title,
      updatedAt: at,
      waitingReason: null,
      workingState: null,
    };
  }

  /** A durably accepted, definitely unsent outbox entry. */
  #newQueueItem(fields: {
    missionId: string;
    agentId: string;
    id: string;
    text: string;
    mode: DeliveryMode;
    sequence: number;
    executionMode?: ExecutionMode | null;
    origin?: QueueItem["origin"];
    purpose?: MessagePurpose;
    sender?: MessageParty | null;
    retryOf?: string | null;
    replacesId?: string | null;
  }): QueueItem {
    const at = this.#iso();
    return {
      agentId: fields.agentId,
      createdAt: at,
      error: null,
      executionMode: fields.executionMode ?? null,
      id: fields.id,
      missionId: fields.missionId,
      mode: fields.mode,
      origin: fields.origin ?? "user",
      purpose: fields.purpose ?? "message",
      replacedById: null,
      replacesId: fields.replacesId ?? null,
      retryOf: fields.retryOf ?? null,
      revision: 0,
      sender: fields.sender ?? null,
      sequence: fields.sequence,
      state: "accepted",
      text: fields.text,
      updatedAt: at,
    };
  }

  static #party(agent: Agent): MessageParty {
    return { agentId: agent.id, role: agent.role, title: agent.title };
  }

  async #launch(missionId: string) {
    const mission = this.get(missionId);
    if (this.#closing || FENCED.has(mission.status)) {
      return;
    }
    const orchestrator = this.#store
      .listAgents(missionId)
      .find((agent) => agent.role === "orchestrator");
    const goal = this.#store.queue.get(`${missionId}:goal`);
    if (
      !(orchestrator && goal) ||
      goal.state !== "accepted" ||
      orchestrator.sessionId
    ) {
      return;
    }
    try {
      const runtime = await this.#ensureRuntime(orchestrator.id);
      this.#requireRuntime(orchestrator.id, runtime);
      this.#scheduleDelivery(orchestrator.id);
    } catch (error) {
      // The goal stays accepted: it was never submitted and is delivered
      // after Resume, never replayed from an uncertain state.
      if (!FENCED.has(this.get(mission.id).status)) {
        const stopped = await this.#stopMission(mission.id, "interrupted");
        if (
          stopped.epoch === mission.epoch + 1 &&
          stopped.status === "interrupted"
        ) {
          this.#fail(
            mission.id,
            "environment",
            `Could not start the Orchestrator: ${errorMessage(error)}`
          );
        }
      }
    }
  }

  #fail(
    missionId: string,
    code: "environment" | "run_failed",
    message: string
  ) {
    // A mission whose main agent never got a session has nothing to resume.
    const started = this.#store
      .listAgents(missionId)
      .some((agent) => agent.role === "orchestrator" && agent.sessionId);
    this.#mutateMission(missionId, (mission) => ({
      ...mission,
      lastError: { code, message, retryAfterMs: null },
      status: !started && code === "environment" ? "failed" : "interrupted",
    }));
    this.#notice(missionId, code, "error", message);
  }

  // ------------------------------------------------------------- runtimes

  async #ensureRuntime(agentId: string): Promise<RuntimeHandle> {
    const agent = this.#store.getAgent(agentId);
    const mission = agent ? this.get(agent.missionId) : null;
    if (!(agent && mission?.workspace)) {
      throw notFound("Agent");
    }
    const live = await this.#workspaceGate.run(
      mission.workspace.path,
      (workspace) => {
        if (this.#closing || FENCED.has(this.get(mission.id).status)) {
          throw conflict("Resume the mission before starting agents");
        }
        const existing = this.#live.get(agentId);
        if (existing?.phase === "retiring") {
          throw conflict("The previous agent execution has not stopped");
        }
        return (
          existing ?? this.#startRuntime(agent, this.get(mission.id), workspace)
        );
      }
    );
    const runtime = await live.ready;
    this.#requireRuntime(agentId, runtime);
    return runtime;
  }

  #startRuntime(agent: Agent, mission: Mission, workspace: string): LiveAgent {
    const agentId = agent.id;
    // Callbacks capture this owner, never whichever runtime later occupies agentId.
    const live = {
      agentId,
      awaitingText: null,
      epoch: mission.epoch,
      fenced: Promise.withResolvers<undefined>(),
      id: randomUUID(),
      missionId: mission.id,
      operations: new Set(),
      phase: "starting" as const,
      planGuidance: false,
      toolCalls: new Map(),
      workspace,
    } as LiveAgent;
    const ids = { agentId, missionId: mission.id };
    live.runtime = this.#createRuntime({
      agentId,
      cwd: workspace,
      disabledToolIds: disabledToolIds(agent.role),
      enabledToolIds: enabledToolIds(agent.role),
      mcpServers: [
        createRoleToolServer(agent.role, agentId, this.#roleHandlers(live)),
      ],
      modelId: agent.model.modelId,
      onAskUser: (ask) =>
        ask.agentId === agentId && this.#isCurrent(agentId, live)
          ? this.#askUser(ask)
          : Promise.resolve({ answers: [], cancelled: true }),
      onEvent: (event) => this.#onAgentEvent(live, event),
      onPermission: async (ask) => {
        if (ask.agentId !== agentId || !this.#isCurrent(agentId, live)) {
          return false;
        }
        const plan = ask.toolUses.find(isExitSpecMode);
        if (plan) {
          return ask.toolUses.length === 1 && agent.role === "orchestrator"
            ? await this.#proposeNativePlan(live, plan)
            : false;
        }
        const result = await this.broker.ask(agentId, ask.toolUses);
        return result.approved && this.#isCurrent(agentId, live) !== null;
      },
      onTiming: (stage, detail) =>
        this.#timing.mark(live.id, stage, ids, detail),
      reasoningEffort: agent.model.reasoningEffort,
      role: agent.role,
      supervisor: this.#supervisor,
      systemPrompt: `${promptFor(agent.role)}\n\nPersistent shared mission files: ${this.#sharedFiles.root(mission.id)}`,
    });
    this.#live.set(agentId, live);
    // An immutable legacy system prompt is never resumed under v2 rules; a
    // linked successor session continues from saved state instead.
    const resumeId =
      agent.promptVersion === PROMPT_VERSION ? agent.sessionId : null;
    this.#timing.mark(live.id, "startup.requested", ids, {
      resume: resumeId !== null,
    });
    this.#setWaiting(agentId, "startup");
    live.started = this.#sharedFiles
      .ensure(mission.id)
      .then(async () => await live.runtime.start(resumeId ?? undefined));
    live.ready = this.#finishStart(live, agent, resumeId);
    return live;
  }

  async #finishStart(
    live: LiveAgent,
    agent: Agent,
    resumeId: string | null
  ): Promise<RuntimeHandle> {
    try {
      const started = await live.started;
      if (!this.#isCurrent(agent.id, live)) {
        throw conflict("Agent startup was cancelled");
      }
      if (live.runtime.availableModels) {
        this.#models.remember(live.runtime.availableModels);
      }
      // PATCH during initialization only records a desired choice. Reconcile
      // before ready resolves, so the first goal cannot use the old model.
      if (agent.role === "orchestrator") {
        const desired = this.get(agent.missionId).orchestrator;
        const native = live.runtime.model;
        const differs =
          native &&
          (native.modelId !== desired.modelId ||
            (desired.reasoningEffort !== null &&
              native.reasoningEffort !== desired.reasoningEffort));
        if (!sameModel(desired, agent.model) || differs) {
          await this.#waitingFor(agent.id, "model", () =>
            this.#reconcileStartingModel(live, desired)
          );
        }
        if (this.get(agent.missionId).executionMode === "plan") {
          await this.#syncNativeMode(live);
        }
      }
      live.phase = "ready";
      if (resumeId) {
        this.#reconcileQueue(agent, live.runtime, started);
      }
      for (const message of started.messages) {
        this.#onAgentEvent(live, { message, type: "message" });
      }
      const latest = this.#store.getAgent(agent.id) ?? agent;
      const successor = resumeId === null && latest.sessionId !== null;
      this.#patchAgent(agent.id, {
        promptVersion: PROMPT_VERSION,
        sessionId: started.sessionId,
        status: "idle",
        waitingReason: null,
        ...(successor && latest.sessionId
          ? {
              previousSessionIds: [
                ...latest.previousSessionIds,
                latest.sessionId,
              ],
              sessionGeneration: latest.sessionGeneration + 1,
            }
          : {}),
      });
      this.#timing.mark(live.id, "startup.ready", {
        agentId: agent.id,
        missionId: agent.missionId,
      });
      if (successor && latest.sessionId) {
        this.#continueLegacy(latest, latest.sessionId);
      }
      return live.runtime;
    } catch (error) {
      await this.#closeRuntime(agent.id, live);
      throw error;
    }
  }

  /**
   * Shows the legacy-to-v2 transition, then gives the successor session a
   * continuation packet. Nothing from the old session is replayed.
   */
  #continueLegacy(agent: Agent, previousSessionId: string) {
    const mission = this.get(agent.missionId);
    const assignment = agent.assignmentId
      ? this.#store.assignments.get(agent.assignmentId)
      : null;
    const titles = new Map(
      this.#store.listAgents(mission.id).map((entry) => [entry.id, entry.title])
    );
    const recent = this.#store
      .transcriptPage(mission.id, null, 60)
      .items.filter(
        (item) =>
          (item.kind === "user" ||
            item.kind === "assistant" ||
            item.kind === "agent_message") &&
          (agent.role === "orchestrator" ||
            item.agentId === agent.id ||
            item.recipient?.agentId === agent.id)
      )
      .slice(-20)
      .map((item) => ({
        kind: item.kind,
        text: item.text,
        who:
          item.kind === "user" ? "User" : (titles.get(item.agentId) ?? "Agent"),
      }));
    this.#appendTranscript(mission.id, [
      {
        agentId: agent.id,
        createdAt: this.#iso(),
        id: `${agent.id}:successor:${previousSessionId}`,
        isError: false,
        kind: "system",
        missionId: mission.id,
        purpose: "control",
        recipient: null,
        requestId: null,
        sender: null,
        text: `${agent.title} continues in a new session under the updated app instructions. Its earlier session is preserved and readable through the mission history; nothing from it is replayed.`,
        toolName: null,
        toolUseId: null,
      },
    ]);
    void this.#systemSubmit(
      agent.id,
      continuationMessage({
        assignment,
        handoffs:
          agent.role === "orchestrator"
            ? this.#store.assignments.list(mission.id, ["handed_off"])
            : [],
        mission,
        plans: this.#store.plans.list(mission.id),
        previousSessionId,
        recent,
        role: agent.role,
        todos: this.#store.todos
          .list(mission.id)
          .filter((todo) => todo.agentId === agent.id),
      }),
      "steer"
    );
  }

  /**
   * Native Spec mode follows the mission's execution mode. Planning guidance
   * is supplied once per session as model-only context, so ordinary prompts
   * never carry it.
   */
  async #syncNativeMode(live: LiveAgent) {
    const mode = this.get(live.missionId).executionMode;
    await live.runtime.setInteractionMode(mode === "plan" ? "spec" : "auto");
    this.#requireCurrent(live.agentId, live);
    if (mode === "plan" && !live.planGuidance) {
      await live.runtime.addContext(
        `${SYSTEM_PREFIX}plan-guidance:${live.id}`,
        PLAN_GUIDANCE
      );
      this.#requireCurrent(live.agentId, live);
      live.planGuidance = true;
    }
  }

  async #reconcileStartingModel(
    live: LiveAgent,
    desired: AgentModelSettings
  ): Promise<void> {
    const effective = await this.#models.resolve(desired, "Orchestrator");
    this.#requireCurrent(live.agentId, live);
    const confirmed = await live.runtime.updateModel(effective);
    this.#requireCurrent(live.agentId, live);
    if (!sameModel(confirmed, effective)) {
      throw conflict(
        "Droid did not accept the requested model settings; review the mission and retry"
      );
    }
    this.#patchAgent(live.agentId, { model: confirmed });
    const latest = this.get(live.missionId).orchestrator;
    if (!sameModel(desired, latest)) {
      await this.#reconcileStartingModel(live, latest);
    }
  }

  #requireRuntime(agentId: string, runtime: RuntimeHandle) {
    const current = this.#isCurrent(agentId);
    if (
      !current ||
      current.live.runtime !== runtime ||
      current.live.phase !== "ready"
    ) {
      throw conflict("The agent execution is no longer running");
    }
    return current;
  }

  /** After load, mirrored entries are compared with native state and never resubmitted. */
  #reconcileQueue(
    agent: Agent,
    runtime: RuntimeHandle,
    started: RuntimeStartResult
  ) {
    const consumedIds = new Set(
      started.messages
        .map((message) => message.requestId)
        .filter((id): id is string => id !== null)
    );
    // Accepted entries never reached the runner; the outbox delivers them.
    const mirrored = this.#store.queue
      .list(agent.missionId)
      .filter(
        (item) =>
          item.agentId === agent.id &&
          item.state !== "accepted" &&
          (!TERMINAL_QUEUE.has(item.state) || consumedIds.has(item.id))
      );
    runtime.queue.hydrate(
      mirrored.map((item) => ({
        error: item.error,
        id: item.id,
        mode: item.mode,
        state: item.state,
        text: item.text,
      }))
    );
    runtime.queue.reconcile({
      consumedIds,
      pendingIds: started.pendingIds,
      queuedIds: started.queuedIds,
    });
  }

  #closeRuntime(
    agentId: string,
    owner = this.#live.get(agentId)
  ): Promise<StopResult> {
    if (!owner) {
      return Promise.resolve({ stopped: true, survivors: [] });
    }
    if (owner.retirement) {
      return owner.retirement;
    }
    const starting = owner.phase === "starting";
    owner.phase = "retiring";
    owner.fenced.resolve(undefined);
    this.#deltas.dropGeneration(owner.id);
    owner.toolCalls.clear();
    this.#unbindPlans(owner);
    // Settle pending decisions before another execution can occupy this agent ID.
    const errors: unknown[] = [];
    try {
      this.#invalidateAgentDecisions(owner);
    } catch (error) {
      errors.push(error);
    }
    try {
      this.#cancelQuestions(owner.missionId, agentId);
    } catch (error) {
      errors.push(error);
    }
    owner.retirement = this.#own(this.#disposeRuntime(owner, starting, errors));
    return owner.retirement;
  }

  #invalidateAgentDecisions(owner: LiveAgent) {
    // The owner is fenced first. Deciding any of its pending requests now makes
    // the broker settle them as stale without granting authority to a successor.
    try {
      for (const request of this.broker.pending(owner.missionId)) {
        if (request.agentId !== owner.agentId) {
          continue;
        }
        try {
          this.broker.decide(request.id, "deny", request.epoch);
        } catch (error) {
          if (!(error instanceof StaleDecisionError)) {
            throw error;
          }
        }
      }
    } finally {
      this.leases.cancelWaits(owner.agentId);
    }
  }

  async #disposeRuntime(
    owner: LiveAgent,
    starting: boolean,
    errors: unknown[]
  ): Promise<StopResult> {
    // Yield the role-tool reply; retirement remains owned and publish stays fenced.
    await yieldImmediate();
    const controller = new AbortController();
    const cooperative = drainNative(owner.runtime, controller.signal).catch(
      () => {
        // A fenced SDK failure is uncertain delivery, not a reason to delay supervision.
      }
    );
    // A responsive runner may acknowledge deletion, but a blocked interrupt or
    // delete never owns the lifetime of process-confirming close.
    await Promise.race([cooperative, yieldImmediate()]);
    let result = await MissionService.#confirmRuntimeClosed(owner, errors);
    if (starting) {
      await owner.started.catch(() => null);
      // Startup may have registered a late process after close began.
      result = await MissionService.#confirmRuntimeClosed(owner, errors);
    }
    controller.abort();
    await Promise.allSettled(owner.operations);
    try {
      for (const entry of owner.runtime.queue.list()) {
        this.#syncQueue(owner.agentId, entry);
      }
    } catch (error) {
      errors.push(error);
    }
    try {
      this.#patchAgent(owner.agentId, {
        holdsWriteLease: result.stopped
          ? false
          : (this.#store.getAgent(owner.agentId)?.holdsWriteLease ?? false),
        status: result.stopped ? "stopped" : "failed",
      });
    } catch (error) {
      errors.push(error);
    }
    if (result.stopped) {
      try {
        this.leases.forget(owner.agentId);
      } catch (error) {
        errors.push(error);
      }
      if (this.#live.get(owner.agentId) === owner) {
        this.#live.delete(owner.agentId);
      }
    } else {
      try {
        this.#mutateMission(owner.missionId, (mission) => ({
          ...mission,
          lastError: {
            code: "stop_failed",
            message: `Agent execution could not stop: ${result.survivors.join(", ")}`,
            retryAfterMs: null,
          },
          status: "stop_failed",
        }));
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "Agent execution cleanup failed");
    }
    return result;
  }

  static async #confirmRuntimeClosed(
    owner: LiveAgent,
    errors: unknown[]
  ): Promise<StopResult> {
    try {
      return await owner.runtime.close();
    } catch (error) {
      errors.push(error);
      return { stopped: false, survivors: [] };
    }
  }

  #execute<T>(
    agentId: string,
    runtime: RuntimeHandle,
    effect: () => Promise<T>
  ): Promise<T> {
    const { live } = this.#requireRuntime(agentId, runtime);
    const task = Promise.race([
      effect(),
      live.fenced.promise.then(() => {
        throw new Error(
          "Agent execution stopped before the runner confirmed the operation"
        );
      }),
    ]);
    live.operations.add(task);
    void task.then(
      () => live.operations.delete(task),
      () => live.operations.delete(task)
    );
    return task;
  }

  // --------------------------------------------------------- agent events

  #isCurrent(agentId: string, owner = this.#live.get(agentId)) {
    if (this.#closing) {
      return null;
    }
    const live = this.#live.get(agentId);
    const agent = this.#store.getAgent(agentId);
    const mission = agent ? this.#store.getMission(agent.missionId) : null;
    return !this.#closing &&
      owner &&
      live === owner &&
      live.phase !== "retiring" &&
      agent &&
      mission &&
      !FENCED.has(mission.status) &&
      live.epoch === mission.epoch
      ? { agent, live, mission }
      : null;
  }

  #onAgentEvent(live: LiveAgent, event: AgentEvent) {
    const { agentId } = live;
    const current = this.#isCurrent(agentId, live);
    if (!current) {
      return;
    }
    if (event.type === "queue") {
      this.#syncQueue(agentId, event.entry);
      return;
    }
    const { agent, mission } = current;
    const base = { agentId, createdAt: this.#iso(), missionId: mission.id };
    switch (event.type) {
      case "text_delta":
      case "thinking_delta": {
        const kind = event.type === "text_delta" ? "text" : "thinking";
        if (live.awaitingText) {
          this.#timing.markOnce(live.awaitingText, `first_${kind}`, {
            agentId,
            missionId: mission.id,
          });
          if (kind === "text") {
            live.awaitingText = null;
          }
        }
        this.#deltas.push(
          textItemId(agentId, event.messageId, kind),
          agentId,
          kind,
          event.delta,
          live.id
        );
        break;
      }
      case "message": {
        for (const use of event.message.toolUses) {
          this.#recordToolCall(live, use.id, {
            input: use.input,
            name: use.name,
          });
        }
        const items = itemsFromMessage(base, event.message).flatMap((entry) => {
          if (entry.kind !== "user") {
            return [entry];
          }
          if (isSystemRequest(entry.requestId)) {
            return [{ ...entry, kind: "system" as const }];
          }
          // Agent messages already have their canonical record; the
          // recipient's native echo must not become a user bubble.
          const queued = entry.requestId
            ? this.#store.queue.get(entry.requestId)
            : null;
          const fromAgent =
            (queued && queued.origin !== "user") ||
            Boolean(event.message.sender);
          return fromAgent ? [] : [entry];
        });
        this.#appendTranscript(mission.id, items);
        for (const result of event.message.toolResults) {
          this.#afterToolResult(
            live,
            mission.id,
            result.toolUseId,
            result.isError
          );
        }
        break;
      }
      case "tool_call": {
        this.#recordToolCall(live, event.toolUseId, {
          input: event.input,
          name: event.name,
        });
        this.#appendTranscript(mission.id, [
          toolCallItem(base, event.toolUseId, event.name, event.input),
        ]);
        break;
      }
      case "tool_result": {
        this.#appendTranscript(mission.id, [
          toolResultItem(base, event.toolUseId, event.content, event.isError),
        ]);
        this.#afterToolResult(live, mission.id, event.toolUseId, event.isError);
        break;
      }
      default: {
        this.#onAgentStatusEvent(agent, mission, event);
      }
    }
  }

  #onAgentStatusEvent(agent: Agent, mission: Mission, event: AgentEvent) {
    switch (event.type) {
      case "working_state": {
        const waiting =
          agent.status === "waiting_permission" ||
          agent.status === "waiting_answer";
        let status: AgentStatus = waiting ? agent.status : "working";
        if (event.state === "idle") {
          status = "idle";
        }
        this.#saveAgent({
          ...agent,
          status,
          waitingReason:
            agent.waitingReason === "retry" ? null : agent.waitingReason,
          workingState: event.state,
        });
        if (event.state === "idle") {
          this.#onAgentIdle(agent, mission);
        }
        break;
      }
      case "turn_completed": {
        this.#deltas.flushAll();
        if (mission.workspace) {
          this.leases.release(mission.workspace.path, agent.id);
        }
        this.#onAgentIdle(agent, mission);
        break;
      }
      case "retry": {
        this.#setWaiting(agent.id, "retry");
        const limited = /rate|429|quota/iu.test(event.reason);
        this.#notice(
          mission.id,
          limited ? "rate_limited" : "info",
          "warning",
          limited
            ? `Rate limited; retrying (attempt ${event.attempt})`
            : `Retrying: ${event.reason}`
        );
        break;
      }
      case "error": {
        this.#mutateMission(mission.id, (m) => ({
          ...m,
          lastError: {
            code: event.errorType ?? "error",
            message: event.message,
            retryAfterMs: null,
          },
        }));
        this.#notice(
          mission.id,
          "run_failed",
          "error",
          event.message || "The agent reported an error"
        );
        break;
      }
      case "process_exit": {
        this.#own(this.#unexpectedExit(agent, mission, event.message));
        break;
      }
      default: {
        break;
      }
    }
  }

  async #unexpectedExit(agent: Agent, mission: Mission, message: string) {
    if (agent.role === "orchestrator") {
      const stopped = await this.#stopMission(mission.id, "interrupted");
      if (
        stopped.epoch === mission.epoch + 1 &&
        stopped.status === "interrupted"
      ) {
        this.#fail(
          mission.id,
          "run_failed",
          `The Orchestrator stopped unexpectedly: ${message}`
        );
      }
      return;
    }
    const result = await this.#closeRuntime(agent.id);
    if (agent.assignmentId) {
      const assignment = this.#store.assignments.get(agent.assignmentId);
      if (assignment?.status === "running") {
        this.#saveAssignment({ ...assignment, status: "failed" });
      }
      if (result.stopped) {
        await this.#pumpAssignments(mission.id);
      }
    }
  }

  #recordToolCall(
    live: LiveAgent,
    toolUseId: string,
    call: { name: string; input: Record<string, unknown> }
  ) {
    // A resumed SDK session may replay earlier messages. Its durable result
    // already updated the checklist; never let that overwrite newer todos.
    if (
      call.name === "TodoWrite" &&
      this.#store.getTranscriptItem(
        toolItemId(live.agentId, toolUseId, "result")
      )
    ) {
      return;
    }
    live.toolCalls.set(toolUseId, call);
  }

  #afterToolResult(
    live: LiveAgent,
    missionId: string,
    toolUseId: string,
    isError: boolean
  ) {
    const { agentId } = live;
    const call = live.toolCalls.get(toolUseId);
    live.toolCalls.delete(toolUseId);
    if (!call) {
      return;
    }
    // Failed or uncertain Git actions are re-read too, never retried blindly.
    const gitAction =
      (call.name === "Execute" && GIT_ACTION.test(commandOf(call.input))) ||
      (call.name === "Script" && GIT_ACTION.test(JSON.stringify(call.input)));
    if (gitAction) {
      this.#observeGit(missionId);
    }
    if (isError) {
      return;
    }
    if (call.name === "TodoWrite") {
      const todos = nativeTodos(call.input);
      if (todos !== null) {
        this.#updateTodos(agentId, todos);
      }
      return;
    }
    const target = pathInput(call.input);
    if (WRITE_TOOLS.has(call.name)) {
      this.#publish(missionId, {
        data: { paths: target ? [target] : [] },
        type: "workspace.changed",
      });
    }
    if (
      target &&
      call.name !== "Read" &&
      PREVIEWABLE.test(mediaTypeOf(target))
    ) {
      this.#own(
        this.#attachArtifact(agentId, { path: target }, live).catch(() => null)
      );
    }
  }

  async #attachArtifact(
    agentId: string,
    input: { path: string; name?: string | undefined },
    owner = this.#live.get(agentId)
  ) {
    const { agent, mission } = this.#requireCurrent(agentId, owner);
    const root = mission.workspace?.path;
    if (!root) {
      throw new Error("The mission has no folder");
    }
    const relative = path.isAbsolute(input.path)
      ? path.relative(root, input.path)
      : input.path;
    const target = await resolveWorkspacePath(root, relative);
    if (!target.real) {
      throw new Error(`No file at ${input.path}`);
    }
    const artifact = await this.#artifacts.import({
      agentId: agent.id,
      createdAt: this.#iso(),
      missionId: mission.id,
      name: input.name ?? path.basename(target.rel),
      source: target.real,
    });
    this.#requireCurrent(agentId, owner);
    this.#log.commit((emit) => {
      this.#store.artifacts.put(artifact);
      emit(mission.id, { data: { artifact }, type: "artifact.created" });
    });
    return `Attached ${artifact.name} as an artifact.`;
  }

  #syncQueue(agentId: string, entry: NativeQueueEntry) {
    if (isSystemRequest(entry.id)) {
      return;
    }
    const item = this.#store.queue.get(entry.id);
    if (!item || item.agentId !== agentId) {
      return;
    }
    if (
      item.state === entry.state &&
      item.mode === entry.mode &&
      item.error === entry.error
    ) {
      return;
    }
    this.#saveQueueItem({
      ...item,
      error: entry.error,
      mode: entry.mode,
      revision: item.revision + 1,
      state: entry.state,
      updatedAt: this.#iso(),
    });
  }

  // ------------------------------------------------------------ questions

  #askUser(ask: AskUserAsk): Promise<AskUserAnswer> {
    const current = this.#isCurrent(ask.agentId);
    if (!current || FENCED.has(current.mission.status)) {
      return Promise.resolve({ answers: [], cancelled: true });
    }
    const question: Question = {
      agentId: ask.agentId,
      answers: null,
      createdAt: this.#iso(),
      epoch: current.mission.epoch,
      id: randomUUID(),
      missionId: current.mission.id,
      questions: ask.questions.map((q) => ({
        ...q,
        index: Math.max(1, q.index),
      })),
      status: "pending",
    };
    const { promise, resolve } = Promise.withResolvers<AskUserAnswer>();
    this.#questions.set(question.id, { resolve });
    this.#saveQuestion(question);
    this.#patchAgent(ask.agentId, {
      status: "waiting_answer",
      waitingReason: "answer",
    });
    return promise;
  }

  answerQuestion(
    missionId: string,
    questionId: string,
    input: AnswerQuestionRequest
  ): Question {
    const request = AnswerQuestionRequestSchema.parse(input);
    const question = this.#store.questions.get(questionId);
    const pending = this.#questions.get(questionId);
    const mission = this.get(missionId);
    if (!question || question.missionId !== missionId) {
      throw notFound("Question");
    }
    if (
      !pending ||
      question.status !== "pending" ||
      request.epoch !== question.epoch ||
      mission.epoch !== question.epoch
    ) {
      throw stale("This question is no longer waiting for an answer");
    }
    this.#questions.delete(questionId);
    const answered: Question = {
      ...question,
      answers: request.cancelled ? null : request.answers,
      status: request.cancelled ? "cancelled" : "answered",
    };
    this.#saveQuestion(answered);
    this.#patchAgent(question.agentId, {
      status: "working",
      waitingReason: null,
    });
    pending.resolve({
      answers: request.answers.map((answer) => ({
        answer: answer.answer,
        index: answer.index,
        question:
          question.questions.find((q) => q.index === answer.index)?.question ??
          "",
      })),
      cancelled: request.cancelled,
    });
    return answered;
  }

  #cancelQuestions(missionId: string, agentId?: string) {
    for (const question of this.#store.questions.list(missionId, ["pending"])) {
      if (agentId && question.agentId !== agentId) {
        continue;
      }
      this.#questions
        .get(question.id)
        ?.resolve({ answers: [], cancelled: true });
      this.#questions.delete(question.id);
      this.#saveQuestion({ ...question, status: "cancelled" });
    }
  }

  // ---------------------------------------------------------- permissions

  decidePermission(
    missionId: string,
    requestId: string,
    request: DecidePermissionRequest
  ): PermissionRequest {
    const stored = this.#store.permissions.get(requestId);
    if (!stored || stored.missionId !== missionId) {
      throw notFound("Approval");
    }
    try {
      return this.broker.decide(requestId, request.decision, request.epoch);
    } catch (error) {
      if (error instanceof StaleDecisionError) {
        throw stale(error.message);
      }
      throw error;
    }
  }

  // ----------------------------------------------------------------- plan

  /**
   * Answers the exact live native ExitSpecMode request bound to this
   * revision: approve proceeds once, reject cancels and returns feedback.
   * Without a live binding nothing is approved, whatever the stored status.
   */
  decidePlan(missionId: string, request: DecidePlanRequest): PlanRevision {
    const mission = this.get(missionId);
    if (FENCED.has(mission.status)) {
      throw conflict("Resume the mission before deciding on the plan");
    }
    const plan = this.#store.plans
      .list(missionId)
      .find((p) => p.revision === request.planRevision);
    if (!plan) {
      throw notFound("Plan revision");
    }
    if (plan.status !== "proposed") {
      throw stale("This plan revision was already decided or replaced");
    }
    const binding = this.#planBindings.get(plan.id);
    if (
      !(plan.actionable && binding) ||
      plan.epoch !== mission.epoch ||
      !this.#isCurrent(binding.live.agentId, binding.live)
    ) {
      throw stale(
        "This plan is no longer waiting for approval. Resume the mission so the agent can present it again"
      );
    }
    this.#planBindings.delete(plan.id);
    const decided: PlanRevision = {
      ...plan,
      actionable: false,
      decidedAt: this.#iso(),
      feedback: request.feedback?.trim() || null,
      status: request.approve ? "approved" : "rejected",
    };
    this.#log.commit((emit) => {
      this.#savePlan(decided, emit);
      this.#saveMission(emit, {
        ...mission,
        executionMode: request.approve ? "work" : mission.executionMode,
        pendingExecutionMode: null,
        status: "running",
      });
    });
    binding.resolve(request.approve);
    if (!request.approve) {
      void this.#systemSubmit(
        binding.live.agentId,
        planRejectedMessage(decided, decided.feedback),
        "steer"
      );
    }
    this.#scheduleDelivery(binding.live.agentId);
    return decided;
  }

  /** Records a native ExitSpecMode proposal and waits for the user's decision. */
  async #proposeNativePlan(
    live: LiveAgent,
    use: PermissionToolUse
  ): Promise<boolean> {
    const current = this.#isCurrent(live.agentId, live);
    if (!current) {
      return false;
    }
    const { agent, mission } = current;
    const title =
      typeof use.details.title === "string" && use.details.title.trim()
        ? use.details.title.trim()
        : "Plan";
    const plans = this.#store.plans.list(mission.id);
    const plan: PlanRevision = {
      actionable: true,
      agentId: agent.id,
      createdAt: this.#iso(),
      decidedAt: null,
      epoch: mission.epoch,
      feedback: null,
      guidanceVersion: live.planGuidance ? PLAN_GUIDANCE_VERSION : null,
      id: randomUUID(),
      markdown: typeof use.details.plan === "string" ? use.details.plan : "",
      missionId: mission.id,
      revision: Math.max(0, ...plans.map((p) => p.revision)) + 1,
      sessionId: agent.sessionId,
      status: "proposed",
      title,
      toolUseId: use.toolUseId || null,
    };
    const { promise, resolve } = Promise.withResolvers<boolean>();
    this.#log.commit((emit) => {
      for (const previous of plans.filter((p) => p.status === "proposed")) {
        this.#planBindings.get(previous.id)?.resolve(false);
        this.#planBindings.delete(previous.id);
        this.#savePlan(
          { ...previous, actionable: false, status: "superseded" },
          emit
        );
      }
      this.#savePlan(plan, emit);
      this.#saveMission(emit, { ...mission, status: "awaiting_approval" });
    });
    this.#planBindings.set(plan.id, { live, resolve });
    this.#saveSharedFile(
      mission.id,
      `plans/plan-${plan.revision}.md`,
      `# ${plan.title}\n\n${plan.markdown}\n`
    );
    // The native request blocks the turn exactly like a tool permission.
    this.#patchAgent(agent.id, {
      status: "waiting_permission",
      waitingReason: "permission",
    });
    try {
      const approved = await promise;
      return approved && this.#isCurrent(live.agentId, live) !== null;
    } finally {
      if (
        this.#isCurrent(live.agentId, live) &&
        this.#store.getAgent(agent.id)?.status === "waiting_permission"
      ) {
        this.#patchAgent(agent.id, { status: "working", waitingReason: null });
      }
    }
  }

  /**
   * Pause, crash or replacement ends the native request: its card becomes
   * non-actionable and the agent must present the plan again after Resume.
   */
  #unbindPlans(owner: LiveAgent) {
    for (const [planId, binding] of this.#planBindings) {
      if (binding.live !== owner) {
        continue;
      }
      this.#planBindings.delete(planId);
      binding.resolve(false);
      const plan = this.#store.plans
        .list(owner.missionId)
        .find((entry) => entry.id === planId);
      if (plan?.actionable) {
        this.#log.commit((emit) =>
          this.#savePlan({ ...plan, actionable: false }, emit)
        );
      }
    }
  }

  #enterPlan(agentId: string, reason: string | undefined, owner: LiveAgent) {
    const { agent, mission } = this.#requireCurrent(agentId, owner);
    if (agent.role !== "orchestrator") {
      throw new Error("Only the main agent can enter Plan mode.");
    }
    if (mission.executionMode === "plan") {
      return "Plan mode is already active. Continue planning and present the plan with ExitSpecMode.";
    }
    this.#mutateMission(mission.id, (m) => ({
      ...m,
      executionMode: "plan",
      pendingExecutionMode: null,
    }));
    this.#planEntries.set(mission.id, reason?.trim() || null);
    return "Plan mode recorded: every agent is now read-only. End your turn now; planning continues automatically in Spec mode.";
  }

  /** The main loop yielded: apply a requested Plan entry or a waiting transition. */
  #onAgentIdle(agent: Agent, mission: Mission) {
    if (agent.role !== "orchestrator") {
      return;
    }
    if (this.#planEntries.has(mission.id)) {
      const reason = this.#planEntries.get(mission.id) ?? null;
      this.#planEntries.delete(mission.id);
      this.#own(this.#activatePlanEntry(agent.id, reason));
      return;
    }
    if (deliverableFor(this.#store.queue.list(mission.id), agent.id).length) {
      this.#scheduleDelivery(agent.id);
    }
  }

  async #activatePlanEntry(agentId: string, reason: string | null) {
    const owner = this.#live.get(agentId);
    const current = owner ? this.#isCurrent(agentId, owner) : null;
    if (
      !(owner && current) ||
      owner.phase !== "ready" ||
      current.mission.executionMode !== "plan"
    ) {
      return;
    }
    try {
      await this.#syncNativeMode(owner);
    } catch (error) {
      this.#notice(
        current.mission.id,
        "run_failed",
        "error",
        `Could not switch the main agent to Plan mode: ${errorMessage(error)}`
      );
      return;
    }
    await this.#sendSystem(agentId, planEnteredMessage(reason), "steer");
  }

  #orchestrator(missionId: string) {
    const agent = this.#store
      .listAgents(missionId)
      .find((a) => a.role === "orchestrator");
    if (!agent) {
      throw notFound("Orchestrator");
    }
    return agent;
  }

  #systemSubmit(agentId: string, text: string, mode: DeliveryMode) {
    return this.#own(this.#sendSystem(agentId, text, mode));
  }

  async #sendSystem(agentId: string, text: string, mode: DeliveryMode) {
    try {
      const runtime = await this.#ensureRuntime(agentId);
      this.#requireRuntime(agentId, runtime);
      await this.#execute(agentId, runtime, () =>
        runtime.submit(`${SYSTEM_PREFIX}${randomUUID()}`, text, mode)
      );
    } catch (error) {
      if (this.#closing) {
        return;
      }
      const agent = this.#store.getAgent(agentId);
      if (agent && !FENCED.has(this.get(agent.missionId).status)) {
        this.#notice(
          agent.missionId,
          "run_failed",
          "error",
          `Could not message ${agent.title}: ${errorMessage(error)}`
        );
      }
    }
  }

  // ----------------------------------------------------------- role tools

  #roleHandlers(owner: LiveAgent): RoleToolHandlers {
    const check = (agentId: string) => this.#requireCurrent(agentId, owner);
    return {
      attachArtifact: async (agentId, input) => {
        check(agentId);
        return await this.#attachArtifact(agentId, input, owner);
      },
      completeMission: async (agentId, input) => {
        check(agentId);
        return await Promise.resolve(this.#completeMission(agentId, input));
      },
      dispatchWorker: async (agentId, input) => {
        check(agentId);
        return await Promise.resolve(this.#dispatchWorker(agentId, input));
      },
      enterPlan: async (agentId, input) => {
        check(agentId);
        return await Promise.resolve(
          this.#enterPlan(agentId, input.reason, owner)
        );
      },
      readHistory: async (agentId, input) => {
        check(agentId);
        return await Promise.resolve(this.#readHistory(agentId, input));
      },
      sendMessage: async (agentId, input) => {
        check(agentId);
        return await Promise.resolve(this.#sendMessage(agentId, input, owner));
      },
      submitHandoff: async (agentId, input) => {
        check(agentId);
        return await Promise.resolve(this.#submitHandoff(agentId, input));
      },
      updateTodos: async (agentId, input) => {
        check(agentId);
        return await Promise.resolve(this.#updateTodos(agentId, input.todos));
      },
    };
  }

  #requireCurrent(agentId: string, owner = this.#live.get(agentId)) {
    const current = this.#isCurrent(agentId, owner);
    if (!current || FENCED.has(current.mission.status)) {
      throw new Error("The mission is paused; stop and wait for the user.");
    }
    return current;
  }

  #dispatchWorker(
    agentId: string,
    input: { title: string; instructions: string; needsWrite: boolean }
  ) {
    const { mission } = this.#requireCurrent(agentId);
    if (mission.executionMode === "plan" && input.needsWrite) {
      throw new Error(
        "Plan mode is read-only: dispatch research or review Workers with needsWrite=false until the user approves the plan."
      );
    }
    const queued = this.#store.assignments.list(mission.id, ["queued"]).length;
    if (queued >= MAX_PENDING_ASSIGNMENTS) {
      throw new Error(
        `Too many queued assignments (${queued}). Wait for handoffs first.`
      );
    }
    const at = this.#iso();
    const assignment = this.#saveAssignment({
      createdAt: at,
      epoch: mission.epoch,
      handoff: null,
      id: randomUUID().slice(0, 8),
      instructions: input.instructions,
      missionId: mission.id,
      needsWrite: input.needsWrite,
      status: "queued",
      title: input.title,
      updatedAt: at,
      workerAgentId: null,
    });
    void this.#pumpAssignments(mission.id);
    return `Assignment ${assignment.id} created. A Worker starts it as soon as a slot is free; its handoff arrives as a message.`;
  }

  #pumpAssignments(missionId: string) {
    return this.#own(this.#pump(missionId));
  }

  async #pump(missionId: string) {
    const mission = this.get(missionId);
    if (this.#closing || FENCED.has(mission.status)) {
      return;
    }
    const limit = this.#settings.get().maxConcurrentWorkers;
    const running = [...this.#live.values()].filter(
      (owner) =>
        owner.missionId === missionId &&
        this.#store.getAgent(owner.agentId)?.role === "worker"
    ).length;
    const starting = this.#store.assignments
      .list(missionId, ["running"])
      .filter(
        (assignment) =>
          !assignment.workerAgentId || !this.#live.has(assignment.workerAgentId)
      ).length;
    // Writable assignments wait while Plan mode keeps every agent read-only.
    const next = this.#store.assignments
      .list(missionId, ["queued"])
      .filter(
        (assignment) =>
          !(mission.executionMode === "plan" && assignment.needsWrite)
      )
      .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, Math.max(0, limit - running - starting));
    await Promise.all(
      next.map((assignment) => this.#startAssignment(mission, assignment))
    );
  }

  async #startAssignment(mission: Mission, assignment: Assignment) {
    const saved = assignment.workerAgentId
      ? this.#store.getAgent(assignment.workerAgentId)
      : null;
    if (assignment.workerAgentId && !saved) {
      this.#saveAssignment({ ...assignment, status: "failed" });
      this.#notice(
        mission.id,
        "run_failed",
        "error",
        `Cannot resume ${assignment.title}: its saved agent is unavailable.`
      );
      return;
    }
    const workers = this.#store
      .listAgents(mission.id)
      .filter((a) => a.role === "worker").length;
    const worker =
      saved ??
      this.#newAgent(mission, "worker", `Worker ${workers + 1}`, assignment.id);
    // A legacy session gets a v2 successor whose continuation packet
    // already restates the assignment.
    const { legacy, resumed } = this.#workerStart(saved, assignment.id);
    this.#saveAgent(worker);
    const running = this.#saveAssignment({
      ...assignment,
      status: "running",
      workerAgentId: worker.id,
    });
    if (!saved) {
      this.#acceptAgentMessage({
        id: `assign:${assignment.id}`,
        purpose: "assignment",
        recipient: worker,
        sender: this.#orchestrator(mission.id),
        text: assignmentMessage(running),
      });
    }
    try {
      if (resumed && !saved?.sessionId) {
        throw new Error(
          "The saved worker session is unavailable; no replacement was created"
        );
      }
      const runtime = await this.#ensureRuntime(worker.id);
      this.#requireRuntime(worker.id, runtime);
      if (resumed && !legacy) {
        await this.#execute(worker.id, runtime, () =>
          runtime.submit(
            `${SYSTEM_PREFIX}resume:${mission.epoch}:${assignment.id}`,
            `[Missions] The user resumed this mission. Continue assignment ${assignment.id} from your saved context. Re-read shared files and inspect the workspace before continuing. Do not repeat completed work.`,
            "steer"
          )
        );
      }
      this.#scheduleDelivery(worker.id);
    } catch (error) {
      await this.#assignmentStartFailed(mission, assignment, worker, error);
    }
  }

  /** How a saved Worker restarts: a resumed session, a legacy successor, or fresh. */
  #workerStart(saved: Agent | null, assignmentId: string) {
    // A Worker stopped before its first delivery has no session to resume;
    // it starts fresh and its still-accepted assignment message is delivered.
    const neverStarted =
      saved !== null &&
      !saved.sessionId &&
      this.#store.queue.get(`assign:${assignmentId}`)?.state === "accepted";
    const resumed = saved !== null && !neverStarted;
    return {
      legacy: resumed && saved.promptVersion !== PROMPT_VERSION,
      resumed,
    };
  }

  async #assignmentStartFailed(
    mission: Mission,
    assignment: Assignment,
    worker: Agent,
    error: unknown
  ) {
    this.#failUndelivered(worker.id, "The Worker could not start");
    const result = await this.#closeRuntime(worker.id);
    if (!FENCED.has(this.get(mission.id).status)) {
      this.#patchAgent(worker.id, { status: "failed" });
    }
    const latest = this.#store.assignments.get(assignment.id) ?? assignment;
    if (latest.status === "running") {
      this.#saveAssignment({ ...latest, status: "failed" });
    }
    if (!FENCED.has(this.get(mission.id).status) && !this.#closing) {
      this.#notice(
        mission.id,
        "run_failed",
        "error",
        `Assignment ${assignment.title} could not start: ${errorMessage(error)}`
      );
      this.#saveSharedFile(
        mission.id,
        `errors/${worker.id}-${mission.epoch}.md`,
        `# ${assignment.title}\n\n${errorMessage(error)}\n`
      );
      void this.#systemSubmit(
        this.#orchestrator(mission.id).id,
        `[Missions] Assignment ${assignment.id} could not start: ${errorMessage(error)}`,
        "steer"
      );
      if (result.stopped) {
        await this.#pumpAssignments(mission.id);
      }
    }
  }

  /**
   * Agent-to-agent messages: sender identity is bound by the tool server,
   * the recipient must belong to the same mission, and messages always steer.
   */
  #sendMessage(agentId: string, input: SendMessageInput, owner: LiveAgent) {
    const { agent, mission } = this.#requireCurrent(agentId, owner);
    const text = input.text.trim();
    if (!text || text.length > MAX_AGENT_MESSAGE) {
      throw new Error(
        `Messages must be 1-${MAX_AGENT_MESSAGE} characters; put longer reports in shared files.`
      );
    }
    const recipient = this.#recipientOf(agent, mission, input.to);
    const id = `msg:${agent.id}:${input.messageId}`;
    const existing = this.#store.queue.get(id);
    if (existing) {
      if (
        !sameMessage(existing, {
          agentId: recipient.agent.id,
          executionMode: null,
          missionId: mission.id,
          mode: "steer",
          text,
        })
      ) {
        throw new Error(
          `messageId ${input.messageId} was already used for a different message; use a new messageId.`
        );
      }
      return `Message ${input.messageId} was already accepted (${existing.state}); it was not sent again.`;
    }
    const outstanding = this.#store.queue
      .list(mission.id)
      .filter(
        (item) =>
          item.agentId === recipient.agent.id &&
          item.origin === "agent" &&
          item.purpose === "message" &&
          isOutstanding(item)
      ).length;
    if (outstanding >= MAX_OUTSTANDING_MESSAGES) {
      throw new Error(
        `${recipient.label} already has ${outstanding} undelivered messages. Wait for it to catch up, then send again.`
      );
    }
    this.#acceptAgentMessage({
      id,
      purpose: "message",
      recipient: recipient.agent,
      sender: agent,
      text,
    });
    return `Message ${input.messageId} accepted for ${recipient.label}. It is delivered at the recipient's next tool boundary; acceptance does not mean it was read.`;
  }

  #recipientOf(sender: Agent, mission: Mission, to: string) {
    const target = to.trim();
    if (sender.role === "worker") {
      if (target.toLowerCase() !== MAIN_RECIPIENT) {
        throw new Error(
          `Workers can only message the main agent; use to="${MAIN_RECIPIENT}".`
        );
      }
      return { agent: this.#orchestrator(mission.id), label: "the main agent" };
    }
    if (target.toLowerCase() === MAIN_RECIPIENT) {
      throw new Error(
        "You are the main agent; address a Worker by its assignment id."
      );
    }
    const assignment = this.#store.assignments.get(target);
    if (
      !assignment ||
      assignment.missionId !== mission.id ||
      !assignment.workerAgentId
    ) {
      throw new Error(`Unknown or unstarted assignment ${target}.`);
    }
    if (assignment.status !== "running") {
      throw new Error(
        `Assignment ${assignment.id} is ${assignment.status}; its Worker is not running.`
      );
    }
    const worker = this.#store.getAgent(assignment.workerAgentId);
    if (!worker) {
      throw new Error(`The Worker on ${assignment.id} is unavailable.`);
    }
    return { agent: worker, label: `${worker.title} (${assignment.id})` };
  }

  /**
   * Persists an agent message and its one canonical transcript record in a
   * single transaction, then schedules delivery. `alsoCommit` lets a handoff
   * persist together with its outbound receipt.
   */
  #acceptAgentMessage(message: {
    id: string;
    purpose: MessagePurpose;
    sender: Agent;
    recipient: Agent;
    text: string;
    alsoCommit?: (emit: Emit) => void;
  }): QueueItem {
    const { missionId } = message.recipient;
    const sender = MissionService.#party(message.sender);
    const item = this.#newQueueItem({
      agentId: message.recipient.id,
      id: message.id,
      missionId,
      mode: "steer",
      origin: "agent",
      purpose: message.purpose,
      sender,
      sequence: nextSequence(this.#store.queue.list(missionId)),
      text: message.text,
    });
    const record = agentMessageItem(
      { agentId: message.sender.id, createdAt: item.createdAt, missionId },
      {
        purpose: message.purpose,
        queueItemId: item.id,
        recipient: MissionService.#party(message.recipient),
        sender,
        text: message.text,
      }
    );
    this.#log.commit((emit) => {
      message.alsoCommit?.(emit);
      this.#store.queue.put(item);
      emit(missionId, { data: { item }, type: "queue.updated" });
      if (!this.#store.getTranscriptItem(record.id)) {
        const saved = this.#store.appendTranscript(record);
        emit(missionId, { data: { item: saved }, type: "transcript.item" });
      }
    });
    this.#timing.mark(item.id, "message.accepted", {
      agentId: item.agentId,
      missionId,
    });
    this.#scheduleDelivery(item.agentId);
    return item;
  }

  // -------------------------------------------------------------- outbox

  /** One delivery loop per recipient; later acceptances rerun it. */
  #scheduleDelivery(agentId: string) {
    if (this.#closing) {
      return;
    }
    const running = this.#deliveries.get(agentId);
    if (running) {
      running.again = true;
      return;
    }
    const state = { again: false };
    this.#deliveries.set(agentId, state);
    this.#own(this.#deliver(agentId, state));
  }

  async #deliver(agentId: string, state: { again: boolean }) {
    try {
      do {
        state.again = false;
        // oxlint-disable-next-line no-await-in-loop -- passes must not overlap
        await this.#deliverPass(agentId);
      } while (state.again && !this.#closing);
    } finally {
      this.#deliveries.delete(agentId);
    }
  }

  async #deliverPass(agentId: string) {
    const agent = this.#store.getAgent(agentId);
    const mission = agent ? this.#store.getMission(agent.missionId) : null;
    if (!(agent && mission) || this.#closing || FENCED.has(mission.status)) {
      return;
    }
    if (
      deliverableFor(this.#store.queue.list(mission.id), agentId).length === 0
    ) {
      return;
    }
    if (agent.role === "worker") {
      const assignment = agent.assignmentId
        ? this.#store.assignments.get(agent.assignmentId)
        : null;
      if (assignment?.status !== "running") {
        this.#failUndelivered(agentId, "The Worker is no longer running");
        return;
      }
      if (!this.#live.has(agentId)) {
        // Worker startup belongs to its assignment; it reschedules delivery.
        return;
      }
    }
    let runtime: RuntimeHandle;
    try {
      runtime = await this.#ensureRuntime(agentId);
    } catch (error) {
      if (!(this.#closing || FENCED.has(this.get(mission.id).status))) {
        this.#notice(
          mission.id,
          "run_failed",
          "warning",
          `Messages to ${agent.title} are waiting: it could not start (${errorMessage(error)}).`
        );
      }
      return;
    }
    const current = this.#isCurrent(agentId);
    if (!current || current.live.runtime !== runtime) {
      return;
    }
    await this.#drainOutbox(current.live, runtime);
  }

  async #drainOutbox(live: LiveAgent, runtime: RuntimeHandle) {
    const { agentId } = live;
    for (;;) {
      const current = this.#isCurrent(agentId, live);
      if (!current || live.phase !== "ready") {
        return;
      }
      const [next] = deliverableFor(
        this.#store.queue.list(current.mission.id),
        agentId
      );
      if (!next) {
        return;
      }
      const ready =
        current.agent.role !== "orchestrator" ||
        // oxlint-disable-next-line no-await-in-loop -- strict admission order
        (await this.#applyRequestedMode(live, next));
      // oxlint-disable-next-line no-await-in-loop -- strict admission order
      if (!(ready && (await this.#submitAccepted(live, runtime, next)))) {
        return;
      }
    }
  }

  /**
   * A requested mode is an ordered boundary: it applies only once the main
   * loop and shared writes are quiescent; until then this and every later
   * message stay in the outbox.
   */
  async #applyRequestedMode(live: LiveAgent, item: QueueItem) {
    const mission = this.get(live.missionId);
    const target = item.executionMode;
    if (target === null || target === mission.executionMode) {
      if (mission.pendingExecutionMode !== null) {
        this.#mutateMission(mission.id, (m) => ({
          ...m,
          pendingExecutionMode: null,
        }));
      }
      return true;
    }
    if (!this.#quiescent(live)) {
      if (mission.pendingExecutionMode !== target) {
        this.#mutateMission(mission.id, (m) => ({
          ...m,
          pendingExecutionMode: target,
        }));
      }
      return false;
    }
    this.#mutateMission(mission.id, (m) => ({
      ...m,
      executionMode: target,
      pendingExecutionMode: null,
    }));
    try {
      await this.#syncNativeMode(live);
      return true;
    } catch (error) {
      if (this.#isCurrent(live.agentId, live)) {
        this.#notice(
          mission.id,
          "run_failed",
          "error",
          `Could not switch the main agent to ${target === "plan" ? "Plan" : "Work"} mode: ${errorMessage(error)}`
        );
      }
      return false;
    }
  }

  #quiescent(live: LiveAgent) {
    const agent = this.#store.getAgent(live.agentId);
    if (!agent) {
      return false;
    }
    const busy =
      agent.status === "working" ||
      agent.status === "waiting_permission" ||
      agent.status === "waiting_answer" ||
      (agent.workingState !== null && agent.workingState !== "idle");
    const nativeOpen = this.#store.queue
      .list(agent.missionId)
      .some(
        (item) =>
          item.agentId === agent.id &&
          (item.state === "submitting" ||
            item.state === "queued" ||
            item.state === "removing")
      );
    return !(busy || nativeOpen) && this.leases.holder(live.workspace) === null;
  }

  /** Persists `submitting` before native I/O; returns whether to continue. */
  async #submitAccepted(
    live: LiveAgent,
    runtime: RuntimeHandle,
    item: QueueItem
  ): Promise<boolean> {
    const latest = this.#store.queue.get(item.id);
    if (latest?.state !== "accepted") {
      // Edited or cancelled locally since it was picked.
      return true;
    }
    const submitting = this.#saveQueueItem({
      ...latest,
      revision: latest.revision + 1,
      state: "submitting",
      updatedAt: this.#iso(),
    });
    const ids = { agentId: live.agentId, missionId: live.missionId };
    live.awaitingText = item.id;
    this.#timing.mark(item.id, "delivery.submitting", ids);
    try {
      await this.#execute(live.agentId, runtime, () =>
        runtime.submit(
          item.id,
          this.#nativeText(item),
          item.mode,
          this.#submitOptions(item)
        )
      );
      this.#timing.mark(item.id, "delivery.admitted", ids);
      return true;
    } catch (error) {
      const after = this.#store.queue.get(item.id) ?? submitting;
      if (after.state === "submitting") {
        this.#saveQueueItem({
          ...after,
          error: errorMessage(error),
          revision: after.revision + 1,
          state: isDefiniteFailure(error) ? "failed" : "unknown",
          updatedAt: this.#iso(),
        });
      }
      // A definite rejection affects only this message; anything uncertain
      // stops the pass so nothing races an ambiguous transport.
      const outcome = this.#store.queue.get(item.id)?.state;
      if (outcome === "unknown" && this.#isCurrent(live.agentId, live)) {
        this.#notice(
          live.missionId,
          "run_failed",
          "warning",
          `Delivery of a message is uncertain (${errorMessage(error)}). It is never sent again automatically; check the conversation and retry it if needed.`
        );
      }
      return outcome === "failed";
    }
  }

  #nativeText(item: QueueItem) {
    if (item.origin !== "agent" || item.purpose !== "message" || !item.sender) {
      return item.text;
    }
    const sender = this.#store.getAgent(item.sender.agentId);
    const reference = sender?.assignmentId
      ? `assignment ${sender.assignmentId}`
      : null;
    return agentMessageText(item.sender.title, reference, item.text);
  }

  #submitOptions(item: QueueItem): SubmitOptions {
    const sender = item.sender
      ? this.#store.getAgent(item.sender.agentId)
      : null;
    if (!sender?.sessionId) {
      return {};
    }
    return {
      sender:
        sender.role === "orchestrator"
          ? { kind: "orchestrator", sessionId: sender.sessionId }
          : { kind: "agent", sessionId: sender.sessionId, title: sender.title },
    };
  }

  /** Definitely unsent messages to a recipient that can no longer take them. */
  #failUndelivered(agentId: string, reason: string) {
    const agent = this.#store.getAgent(agentId);
    if (!agent) {
      return;
    }
    for (const item of deliverableFor(
      this.#store.queue.list(agent.missionId),
      agentId
    )) {
      this.#saveQueueItem({
        ...item,
        error: reason,
        revision: item.revision + 1,
        state: "failed",
        updatedAt: this.#iso(),
      });
    }
  }

  #readHistory(agentId: string, input: HistoryInput) {
    const { mission } = this.#requireCurrent(agentId);
    const page = this.#store.transcriptPage(
      mission.id,
      input.before ?? null,
      Math.min(Math.max(input.limit ?? 40, 1), 100)
    );
    const titles = new Map(
      this.#store.listAgents(mission.id).map((agent) => [agent.id, agent.title])
    );
    const lines = page.items.map((item) => {
      const who =
        item.kind === "user" ? "User" : (titles.get(item.agentId) ?? "Agent");
      const to = item.recipient ? ` → ${item.recipient.title}` : "";
      const tool = item.toolName ? ` ${item.toolName}` : "";
      const text =
        item.text.length > HISTORY_ENTRY_LIMIT
          ? `${item.text.slice(0, HISTORY_ENTRY_LIMIT)}…`
          : item.text;
      return `#${item.seq} ${who}${to} [${item.kind}${tool}]: ${text}`;
    });
    const more = page.hasMore
      ? `Older entries exist: call read_history with before=${page.items[0]?.seq ?? ""}.`
      : "This is the start of the mission history.";
    return `${lines.join("\n") || "No history yet."}\n\n${more}`;
  }

  #observeGit(missionId: string) {
    const observer = this.#gitObserver;
    if (!observer || this.#closing) {
      return;
    }
    this.#own(this.#runGitObserver(observer, missionId));
  }

  async #runGitObserver(observer: GitObserver, missionId: string) {
    try {
      await observer(missionId);
    } catch (error) {
      this.#notice(
        missionId,
        "info",
        "warning",
        `Could not re-read the repository after a Git action: ${errorMessage(error)}`
      );
    }
  }

  #updateTodos(agentId: string, todos: TodoInput[]) {
    const { agent, mission } = this.#requireCurrent(agentId);
    const existing = this.#store.todos
      .list(mission.id)
      .filter((todo) => todo.agentId === agentId);
    const next: Todo[] = todos.map((todo, position) => ({
      agentId,
      content: todo.content,
      id: `${agentId}:${position}`,
      missionId: mission.id,
      position,
      priority: todo.priority,
      status: todo.status,
    }));
    this.#log.commit((emit) => {
      for (const dropped of existing.slice(next.length)) {
        this.#store.todos.delete(dropped.id);
      }
      for (const todo of next) {
        this.#store.todos.put(todo);
      }
      emit(mission.id, {
        data: { agentId: agent.id, todos: next },
        type: "todos.updated",
      });
    });
    return `Saved ${next.length} todos.`;
  }

  #submitHandoff(
    agentId: string,
    input: {
      summary: string;
      filesChanged: string[];
      checks: { command: string; outcome: string }[];
      followUps: string[];
    }
  ) {
    const { agent, mission } = this.#requireCurrent(agentId);
    const assignment = agent.assignmentId
      ? this.#store.assignments.get(agent.assignmentId)
      : null;
    if (!assignment || assignment.status !== "running") {
      throw new Error("You have no running assignment to hand off.");
    }
    const handed: Assignment = {
      ...assignment,
      handoff: input,
      status: "handed_off",
      updatedAt: this.#iso(),
    };
    // The handoff and its outbound receipt persist together; native delivery follows.
    this.#acceptAgentMessage({
      alsoCommit: (emit) => {
        this.#store.assignments.put(handed);
        emit(handed.missionId, {
          data: { assignment: handed },
          type: "assignment.updated",
        });
      },
      id: `handoff:${assignment.id}`,
      purpose: "handoff",
      recipient: this.#orchestrator(mission.id),
      sender: agent,
      text: handoffMessage(agent.title, handed, input),
    });
    this.#saveSharedFile(
      mission.id,
      `handoffs/${assignment.id}.md`,
      `# ${assignment.title}\n\n${input.summary}\n\n## Files\n${input.filesChanged.map((file) => `- \`${file}\``).join("\n")}\n\n## Checks\n${input.checks.map((check) => `- ${check.command}: ${check.outcome}`).join("\n")}\n\n## Follow-ups\n${input.followUps.map((followUp) => `- ${followUp}`).join("\n")}\n`
    );
    this.#own(this.#retireWorker(agent.id, mission.id));
    return "Handoff recorded and queued for the main agent. Stop now.";
  }

  async #retireWorker(agentId: string, missionId: string) {
    const result = await this.#closeRuntime(agentId);
    this.#patchAgent(agentId, {
      status: result.stopped ? "stopped" : "failed",
    });
    if (!result.stopped) {
      this.#notice(
        missionId,
        "stop_failed",
        "error",
        `A Worker's processes did not stop: ${result.survivors.join(", ")}`
      );
    }
    if (result.stopped) {
      await this.#pumpAssignments(missionId);
    }
  }

  #completeMission(
    agentId: string,
    input: { summary: string; checks: { command: string; outcome: string }[] }
  ) {
    const { agent, mission } = this.#requireCurrent(agentId);
    if (agent.role !== "orchestrator") {
      throw new Error("Only the Orchestrator can complete the mission.");
    }
    const running = this.#store.assignments.list(mission.id, [
      "running",
      "queued",
    ]);
    if (running.length > 0) {
      throw new Error(
        `Assignments still open: ${running.map((a) => a.id).join(", ")}`
      );
    }
    const checks = input.checks
      .map((check) => `- ${check.command}: ${check.outcome}`)
      .join("\n");
    const summary = checks
      ? `${input.summary}\n\nChecks:\n${checks}`
      : input.summary;
    this.#own(this.#finishMission(mission.id, summary));
    return "Completion requested. Execution is stopping before the user reviews and publishes.";
  }

  async #finishMission(missionId: string, summary: string) {
    this.#saveSharedFile(missionId, "results/summary.md", summary);
    const epoch = this.get(missionId).epoch + 1;
    const stopped = await this.#stopMission(missionId, "paused");
    if (
      !this.#closing &&
      stopped.epoch === epoch &&
      stopped.status === "paused"
    ) {
      this.#mutateMission(missionId, (mission) => ({
        ...mission,
        status: "completed",
        summary,
      }));
    }
  }

  #saveSharedFile(missionId: string, name: string, content: string) {
    this.#own(this.#writeSharedFile(missionId, name, content));
  }

  async #writeSharedFile(missionId: string, name: string, content: string) {
    try {
      await this.#sharedFiles.write(missionId, name, content);
      this.#publish(missionId, {
        data: { paths: [] },
        type: "workspace.changed",
      });
    } catch (error) {
      this.#notice(
        missionId,
        "info",
        "warning",
        `Could not save shared file ${name}: ${errorMessage(error)}`
      );
    }
  }

  // ---------------------------------------------------------------- queue

  submitMessage(
    missionId: string,
    request: SubmitMessageRequest
  ): Promise<QueueItem> {
    if (this.#closing) {
      return Promise.reject(conflict("The daemon is stopping"));
    }
    try {
      return Promise.resolve(this.#acceptUserMessage(missionId, request));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /** The receipt for a retried operation ID, or a conflict if its intent differs. */
  #acceptedBefore(
    operationId: string,
    intent: Pick<QueueItem, "agentId" | "executionMode" | "mode" | "text"> & {
      missionId: string;
    }
  ) {
    const saved = this.#journal.get(operationId, {
      kind: "mission.message",
      missionId: intent.missionId,
    });
    if (saved) {
      // The journal keeps the original intent; the item's placement may have changed since.
      const { detail } = saved.operation;
      if (
        detail.agentId !== intent.agentId ||
        detail.text !== intent.text ||
        detail.mode !== intent.mode ||
        (detail.executionMode ?? null) !== intent.executionMode
      ) {
        throw conflict(DUPLICATE_OPERATION);
      }
    }
    const existing = this.#store.queue.get(operationId);
    if (
      existing &&
      (existing.missionId !== intent.missionId ||
        (!saved && !sameMessage(existing, intent)))
    ) {
      throw conflict(DUPLICATE_OPERATION);
    }
    return existing;
  }

  #requireRunningWorker(agent: Agent) {
    if (agent.role !== "worker") {
      return;
    }
    const assignment = agent.assignmentId
      ? this.#store.assignments.get(agent.assignmentId)
      : null;
    if (assignment?.status !== "running") {
      throw conflict("This Worker is not running");
    }
  }

  /**
   * Durable acceptance only: the receipt returns before native I/O, and the
   * outbox delivers in sequence order once the recipient can take it, even
   * while its startup is still in progress.
   */
  #acceptUserMessage(missionId: string, request: SubmitMessageRequest) {
    const mission = this.get(missionId);
    const agentId = request.agentId ?? this.#orchestrator(missionId).id;
    const intent = {
      agentId,
      executionMode: request.executionMode ?? null,
      missionId,
      mode: request.mode,
      text: request.text,
    };
    const existing = this.#acceptedBefore(request.operationId, intent);
    if (existing) {
      return existing;
    }
    if (FENCED.has(mission.status)) {
      throw conflict("Resume the mission before sending messages");
    }
    const agent = this.#store.getAgent(agentId);
    if (!agent || agent.missionId !== missionId) {
      throw notFound("Agent");
    }
    if (agent.role === "worker" && intent.executionMode !== null) {
      throw conflict("Only messages to the main agent can change the mode");
    }
    this.#requireRunningWorker(agent);
    const items = this.#store.queue.list(missionId);
    const outstanding = items.filter(
      (item) =>
        item.agentId === agentId &&
        item.origin === "user" &&
        isOutstanding(item)
    ).length;
    if (outstanding >= MAX_OUTSTANDING_MESSAGES) {
      throw conflict(
        `${agent.title} already has ${outstanding} undelivered messages. Wait for them to be delivered or remove some`
      );
    }
    const item = this.#newQueueItem({
      ...intent,
      id: request.operationId,
      sequence: nextSequence(items),
    });
    const at = this.#iso();
    const operation = {
      createdAt: at,
      detail: { ...intent },
      id: request.operationId,
      kind: "mission.message",
      missionId,
      status: "succeeded" as const,
      updatedAt: at,
    };
    this.#log.commit((emit) => {
      this.#store.putOperation(operation, item);
      emit(missionId, { data: { operation }, type: "operation.updated" });
      this.#store.queue.put(item);
      emit(missionId, { data: { item }, type: "queue.updated" });
    });
    this.#timing.mark(item.id, "message.accepted", { agentId, missionId });
    this.#scheduleDelivery(agentId);
    return item;
  }
  #queueItem(missionId: string, itemId: string, expectedRevision: number) {
    const item = this.#store.queue.get(itemId);
    if (!item || item.missionId !== missionId) {
      throw notFound("Queued message");
    }
    if (item.revision !== expectedRevision) {
      throw stale("This message changed; refresh and try again");
    }
    return item;
  }

  /** Native queue operations need the recipient's current ready runtime. */
  #nativeQueueRuntime(item: QueueItem) {
    const live = this.#live.get(item.agentId);
    if (
      !live ||
      !this.#isCurrent(item.agentId, live) ||
      live.phase !== "ready"
    ) {
      throw conflict("The agent for this message is not running");
    }
    return live.runtime;
  }

  /** Applies a local change to a still-accepted message; null once it left the outbox. */
  #reviseAccepted(itemId: string, change: Partial<QueueItem>) {
    const latest = this.#store.queue.get(itemId);
    if (latest?.state !== "accepted") {
      return null;
    }
    return this.#saveQueueItem({
      ...latest,
      ...change,
      revision: latest.revision + 1,
      updatedAt: this.#iso(),
    });
  }

  async changeQueueMode(
    missionId: string,
    itemId: string,
    request: ChangeQueueModeRequest
  ) {
    return await this.#whileBusy(itemId, async () => {
      const item = this.#queueItem(missionId, itemId, request.expectedRevision);
      if (item.state === "accepted") {
        const revised = this.#reviseAccepted(item.id, { mode: request.mode });
        if (revised) {
          return revised;
        }
      }
      const latest = this.#store.queue.get(item.id) ?? item;
      if (latest.state !== "queued") {
        throw conflict(
          latest.state === "sent"
            ? "This message was already delivered"
            : `Cannot change a ${latest.state} message`
        );
      }
      const runtime = this.#nativeQueueRuntime(latest);
      try {
        await this.#execute(latest.agentId, runtime, () =>
          runtime.changeMode(latest.id, request.mode)
        );
      } catch (error) {
        throw conflict(`The runner refused the change: ${errorMessage(error)}`);
      }
      return this.#store.queue.get(item.id) ?? latest;
    });
  }

  async removeQueueItem(
    missionId: string,
    itemId: string,
    expectedRevision: number
  ) {
    const item = this.#queueItem(missionId, itemId, expectedRevision);
    if (TERMINAL_QUEUE.has(item.state)) {
      return item;
    }
    if (item.state === "accepted") {
      const removed = this.#reviseAccepted(item.id, { state: "removed" });
      if (removed) {
        return removed;
      }
    }
    const runtime = this.#nativeQueueRuntime(item);
    return await this.#whileBusy(item.id, async () => {
      await this.#execute(item.agentId, runtime, () => runtime.remove(item.id));
      return this.#store.queue.get(item.id) ?? item;
    });
  }

  /**
   * Sends a failed or uncertain message again as a new message. Never
   * automatic: an `unknown` original may already have been delivered.
   */
  retryQueueItem(
    missionId: string,
    itemId: string,
    request: RetryQueueItemRequest
  ): Promise<QueueItem> {
    if (this.#closing) {
      return Promise.reject(conflict("The daemon is stopping"));
    }
    try {
      return Promise.resolve(this.#retryQueueItem(missionId, itemId, request));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  #retryQueueItem(
    missionId: string,
    itemId: string,
    request: RetryQueueItemRequest
  ): QueueItem {
    const previous = this.#store.queue.get(request.operationId);
    if (previous) {
      if (previous.missionId !== missionId || previous.retryOf !== itemId) {
        throw conflict(DUPLICATE_OPERATION);
      }
      return previous;
    }
    const item = this.#queueItem(missionId, itemId, request.expectedRevision);
    if (item.state !== "failed" && item.state !== "unknown") {
      throw conflict(
        `Only failed or uncertain messages can be retried; this one is ${item.state}`
      );
    }
    if (FENCED.has(this.get(missionId).status)) {
      throw conflict("Resume the mission before retrying messages");
    }
    const recipient = this.#store.getAgent(item.agentId);
    if (!recipient) {
      throw notFound("Agent");
    }
    this.#requireRunningWorker(recipient);
    const retry = this.#newQueueItem({
      agentId: item.agentId,
      executionMode: item.executionMode,
      id: request.operationId,
      missionId,
      mode: item.mode,
      origin: item.origin,
      purpose: item.purpose,
      retryOf: item.id,
      sender: item.sender,
      sequence: nextSequence(this.#store.queue.list(missionId)),
      text: item.text,
    });
    this.#saveQueueItem(retry);
    this.#timing.mark(retry.id, "message.accepted", {
      agentId: retry.agentId,
      missionId,
    });
    this.#scheduleDelivery(retry.agentId);
    return retry;
  }

  #whileBusy<T>(itemId: string, work: () => Promise<T>): Promise<T> {
    return this.#own(this.#mutateQueue(itemId, work));
  }

  async #mutateQueue<T>(itemId: string, work: () => Promise<T>): Promise<T> {
    if (this.#queueBusy.has(itemId)) {
      throw conflict("This message is already being changed");
    }
    this.#queueBusy.add(itemId);
    try {
      return await work();
    } finally {
      this.#queueBusy.delete(itemId);
    }
  }

  async editQueueItem(
    missionId: string,
    itemId: string,
    request: EditQueueItemRequest
  ): Promise<EditQueueItemResponse> {
    const previous = this.#store.queue.get(request.operationId);
    if (previous) {
      if (
        previous.replacesId !== itemId ||
        previous.missionId !== missionId ||
        previous.text !== request.text
      ) {
        throw conflict(DUPLICATE_OPERATION);
      }
      if (
        previous.state === "failed" &&
        previous.error === "Replacement not sent: already_sent"
      ) {
        return { outcome: "already_sent", replacementId: null };
      }
      if (
        previous.state === "failed" &&
        previous.error === "Replacement not sent: delete_unconfirmed"
      ) {
        return { outcome: "delete_unconfirmed", replacementId: null };
      }
      return { outcome: "replaced", replacementId: previous.id };
    }
    this.#journal.get(request.operationId, {
      kind: "mission.queue.edit",
      missionId,
    });
    const item = this.#queueItem(missionId, itemId, request.expectedRevision);
    if (item.state === "sent") {
      return { outcome: "already_sent", replacementId: null };
    }
    if (TERMINAL_QUEUE.has(item.state)) {
      throw conflict(`This message was already ${item.state}`);
    }
    if (item.state === "accepted" && this.#replaceAccepted(item, request)) {
      return { outcome: "replaced", replacementId: request.operationId };
    }
    const runtime = this.#nativeQueueRuntime(item);
    return await this.#whileBusy(item.id, () =>
      this.#whileBusy(request.operationId, () =>
        this.#replaceQueueItem(missionId, item, runtime, request)
      )
    );
  }

  /** Swaps an unsent message for its edit in place, keeping its delivery position. */
  #replaceAccepted(item: QueueItem, request: EditQueueItemRequest) {
    const latest = this.#store.queue.get(item.id);
    if (latest?.state !== "accepted") {
      return false;
    }
    const replacement = this.#newQueueItem({
      agentId: latest.agentId,
      executionMode: latest.executionMode,
      id: request.operationId,
      missionId: latest.missionId,
      mode: latest.mode,
      origin: latest.origin,
      purpose: latest.purpose,
      replacesId: latest.id,
      sender: latest.sender,
      sequence: latest.sequence,
      text: request.text,
    });
    this.#log.commit((emit) => {
      const removed: QueueItem = {
        ...latest,
        replacedById: replacement.id,
        revision: latest.revision + 1,
        state: "removed",
        updatedAt: this.#iso(),
      };
      this.#store.queue.put(removed);
      emit(latest.missionId, {
        data: { item: removed },
        type: "queue.updated",
      });
      this.#store.queue.put(replacement);
      emit(latest.missionId, {
        data: { item: replacement },
        type: "queue.updated",
      });
    });
    this.#scheduleDelivery(replacement.agentId);
    return true;
  }

  async #replaceQueueItem(
    missionId: string,
    item: QueueItem,
    runtime: RuntimeHandle,
    request: EditQueueItemRequest
  ): Promise<EditQueueItemResponse> {
    const replacementId = request.operationId;
    const replacement: QueueItem = {
      ...this.#newQueueItem({
        agentId: item.agentId,
        executionMode: item.executionMode,
        id: replacementId,
        missionId,
        mode: item.mode,
        origin: item.origin,
        purpose: item.purpose,
        replacesId: item.id,
        sender: item.sender,
        sequence: item.sequence,
        text: request.text,
      }),
      // The runtime submits the replacement itself as part of the native edit.
      state: "submitting",
    };
    this.#log.commit((emit) => {
      const linked = {
        ...item,
        replacedById: replacementId,
        revision: item.revision + 1,
        updatedAt: this.#iso(),
      };
      this.#store.queue.put(linked);
      emit(missionId, { data: { item: linked }, type: "queue.updated" });
      this.#store.queue.put(replacement);
      emit(missionId, { data: { item: replacement }, type: "queue.updated" });
    });
    let outcome: EditOutcome;
    try {
      outcome = await this.#execute(item.agentId, runtime, () =>
        runtime.edit(item.id, replacementId, request.text)
      );
    } catch (error) {
      const latest = this.#store.queue.get(replacementId) ?? replacement;
      if (latest.state === "submitting") {
        this.#saveQueueItem({
          ...latest,
          error: errorMessage(error),
          revision: latest.revision + 1,
          state: "unknown",
          updatedAt: this.#iso(),
        });
      }
      return { outcome: "replaced", replacementId };
    }
    if (outcome !== "replaced") {
      this.#log.commit((emit) => {
        const failedReplacement = {
          ...replacement,
          error: `Replacement not sent: ${outcome}`,
          revision: replacement.revision + 1,
          state: "failed" as const,
          updatedAt: this.#iso(),
        };
        this.#store.queue.put(failedReplacement);
        emit(missionId, {
          data: { item: failedReplacement },
          type: "queue.updated",
        });
        const latest = this.#store.queue.get(item.id) ?? item;
        const unlinked = {
          ...latest,
          replacedById: null,
          revision: latest.revision + 1,
          updatedAt: this.#iso(),
        };
        this.#store.queue.put(unlinked);
        emit(missionId, { data: { item: unlinked }, type: "queue.updated" });
      });
    }
    return {
      outcome,
      replacementId: outcome === "replaced" ? replacementId : null,
    };
  }

  // --------------------------------------------------------- update/pause

  update(missionId: string, request: UpdateMissionRequest): Promise<Mission> {
    if (this.#closing) {
      return Promise.reject(conflict("The daemon is stopping"));
    }
    return this.#own(this.#update(missionId, request));
  }

  #checkUpdate(missionId: string, request: UpdateMissionRequest) {
    if (this.#closing) {
      throw conflict("The daemon is stopping");
    }
    const current = this.get(missionId);
    if (current.revision !== request.expectedRevision) {
      throw stale("The mission changed; refresh and try again");
    }
    return current;
  }

  async #update(
    missionId: string,
    request: UpdateMissionRequest
  ): Promise<Mission> {
    this.#checkUpdate(missionId, request);
    const changesModel = Boolean(request.orchestrator || request.worker);
    if (changesModel && this.#modelUpdates.has(missionId)) {
      throw conflict(
        "A model update is already in progress; refresh and try again"
      );
    }
    if (changesModel) {
      this.#modelUpdates.add(missionId);
    }
    try {
      const effective = request.orchestrator
        ? await this.#models.resolve(request.orchestrator, "Orchestrator")
        : undefined;
      if (request.worker) {
        await this.#models.resolve(request.worker, "Worker");
      }
      this.#checkUpdate(missionId, request);
      const agent = this.#orchestrator(missionId);
      const owner = this.#live.get(agent.id);
      if (effective && owner?.phase === "ready") {
        this.#requireRuntime(agent.id, owner.runtime);
        const previous = owner.runtime.model ?? agent.model;
        try {
          const confirmed = await this.#execute(agent.id, owner.runtime, () =>
            owner.runtime.updateModel(effective)
          );
          this.#requireCurrent(agent.id, owner);
          this.#checkUpdate(missionId, request);
          if (!sameModel(confirmed, effective)) {
            throw conflict(
              "Droid returned different model settings than requested"
            );
          }
          this.#patchAgent(agent.id, { model: confirmed });
        } catch (error) {
          await this.#restoreModel(owner, previous);
          if (error instanceof AppError) {
            throw error;
          }
          throw conflict(
            `Droid could not confirm the model update: ${errorMessage(error)}. Refresh before retrying`
          );
        }
      }
      // No await between the final revision check and the atomic mission save.
      this.#checkUpdate(missionId, request);
      const saved = this.#mutateMission(missionId, (m) => ({
        ...m,
        ...(request.autonomy ? { autonomy: request.autonomy } : {}),
        ...(request.title ? { title: request.title } : {}),
        ...(request.orchestrator ? { orchestrator: request.orchestrator } : {}),
        ...(request.worker ? { worker: request.worker } : {}),
      }));
      if (request.orchestrator && !owner) {
        this.#patchAgent(agent.id, { model: saved.orchestrator });
      }
      return saved;
    } finally {
      if (changesModel) {
        this.#modelUpdates.delete(missionId);
      }
    }
  }

  async #restoreModel(owner: LiveAgent, previous: AgentModelSettings) {
    if (!this.#isCurrent(owner.agentId, owner)) {
      return;
    }
    try {
      const restored = await this.#execute(owner.agentId, owner.runtime, () =>
        owner.runtime.updateModel(previous)
      );
      this.#requireCurrent(owner.agentId, owner);
      if (!sameModel(restored, previous)) {
        throw conflict("Droid did not restore the previous settings");
      }
    } catch {
      if (!this.#isCurrent(owner.agentId, owner)) {
        return;
      }
      const confirmed = owner.runtime.model;
      if (confirmed) {
        this.#patchAgent(owner.agentId, { model: confirmed });
        this.#mutateMission(owner.missionId, (mission) => ({
          ...mission,
          orchestrator: confirmed,
        }));
      }
      this.#notice(
        owner.missionId,
        "environment",
        "error",
        "Droid could not restore the previous model. The last confirmed choice is shown; refresh and check the runner before sending another turn"
      );
      throw conflict(
        "The model update could not be restored. Refresh to review the last confirmed choice"
      );
    }
  }

  pause(missionId: string, request: MissionControlRequest): Promise<Mission> {
    if (this.#closing) {
      return Promise.reject(conflict("The daemon is stopping"));
    }
    return this.#own(this.#pause(missionId, request));
  }

  async #pause(
    missionId: string,
    request: MissionControlRequest
  ): Promise<Mission> {
    const { result } = await this.#journal.run(
      { id: request.operationId, kind: "mission.pause", missionId },
      async () => {
        const mission = this.get(missionId);
        if (mission.revision !== request.expectedRevision) {
          throw stale("The mission changed; refresh and try again");
        }
        if (!ACTIVE.has(mission.status) && mission.status !== "completed") {
          throw conflict(`Cannot pause a mission that is ${mission.status}`);
        }
        return await this.#stopMission(missionId, "paused");
      }
    );
    return result;
  }

  /** Stops any idle agents and hides the mission from active work; the worktree is left alone. */
  archive(missionId: string, request: MissionControlRequest): Promise<Mission> {
    if (this.#closing) {
      return Promise.reject(conflict("The daemon is stopping"));
    }
    return this.#own(this.#archive(missionId, request));
  }

  async #archive(
    missionId: string,
    request: MissionControlRequest
  ): Promise<Mission> {
    const { result } = await this.#journal.run(
      { id: request.operationId, kind: "mission.archive", missionId },
      async () => {
        const mission = this.get(missionId);
        if (mission.revision !== request.expectedRevision) {
          throw stale("The mission changed; refresh and try again");
        }
        if (mission.status === "stop_failed") {
          throw conflict(
            "Some agent processes did not stop. Resume the mission to stop them before archiving"
          );
        }
        if (!ARCHIVABLE.has(mission.status)) {
          throw conflict(`A ${mission.status} mission cannot be archived`);
        }
        const stopped = await this.#stopMission(missionId, "paused");
        if (stopped.status === "stop_failed") {
          throw conflict("Some agent processes did not stop");
        }
        return this.#mutateMission(missionId, (m) => ({
          ...m,
          status: "archived",
        }));
      }
    );
    return result;
  }

  /** Fence → new epoch → settle waiters → interrupt → delete native queue → stop and confirm. */
  async #stopMission(
    missionId: string,
    target: "paused" | "interrupted"
  ): Promise<Mission> {
    const fenced = this.#mutateMission(missionId, (m) => ({
      ...m,
      epoch: m.epoch + 1,
      status: "pausing",
    }));
    this.broker.cancelMission(missionId);
    this.#cancelQuestions(missionId);
    const agents = this.#store.listAgents(missionId);
    const results = await Promise.all(
      agents.map(async (agent) => ({
        agent,
        result: await this.#closeRuntime(agent.id),
      }))
    );
    const failed = results.some(({ result }) => !result.stopped);
    const survivors = results.flatMap(({ result }) => result.survivors);
    if (this.get(missionId).epoch !== fenced.epoch) {
      return this.get(missionId);
    }
    this.#settleAfterStop(missionId, results);
    const mission = this.#mutateMission(missionId, (m) => ({
      ...m,
      lastError: failed
        ? {
            code: "stop_failed",
            message: `Processes still running: ${survivors.join(", ")}`,
            retryAfterMs: null,
          }
        : m.lastError,
      status: failed ? "stop_failed" : target,
    }));
    if (failed) {
      this.#notice(
        missionId,
        "stop_failed",
        "error",
        "Some agent processes did not stop. New work is blocked until they do."
      );
    }
    return mission;
  }

  #settleAfterStop(
    missionId: string,
    results: { agent: Agent; result: StopResult }[]
  ) {
    for (const { agent, result } of results) {
      this.#patchAgent(agent.id, {
        holdsWriteLease: result.stopped ? false : agent.holdsWriteLease,
        status: result.stopped ? "stopped" : "failed",
      });
    }
    for (const assignment of this.#store.assignments.list(missionId, [
      "running",
      "queued",
    ])) {
      this.#saveAssignment({ ...assignment, status: "cancelled" });
    }
    for (const item of this.#store.queue.list(missionId)) {
      // Accepted messages were never sent; they stay durable until Resume.
      if (
        !TERMINAL_QUEUE.has(item.state) &&
        item.state !== "unknown" &&
        item.state !== "accepted"
      ) {
        this.#saveQueueItem({
          ...item,
          error: "The runner stopped before this was confirmed",
          revision: item.revision + 1,
          state: "unknown",
          updatedAt: this.#iso(),
        });
      }
    }
  }

  resume(missionId: string, request: MissionControlRequest): Promise<Mission> {
    if (this.#closing) {
      return Promise.reject(conflict("The daemon is stopping"));
    }
    return this.#own(this.#resume(missionId, request));
  }

  async #resume(
    missionId: string,
    request: MissionControlRequest
  ): Promise<Mission> {
    const { result } = await this.#journal.run(
      { id: request.operationId, kind: "mission.resume", missionId },
      async () => {
        const { workspace } = this.get(missionId);
        if (!workspace) {
          throw conflict("The mission has no workspace");
        }
        await this.#workspaceGate.run(workspace.path, async () => {
          if (this.#closing) {
            throw conflict("The daemon is stopping");
          }
          const current = this.get(missionId);
          if (current.revision !== request.expectedRevision) {
            throw stale("The mission changed; refresh and try again");
          }
          if (!RESUMABLE.has(current.status)) {
            throw conflict(`Cannot resume a mission that is ${current.status}`);
          }
          await this.#confirmStopped(missionId);
          const problems = await verifyBinding(workspace);
          if (problems.length > 0) {
            throw conflict(problems.join(". "));
          }
          this.#mutateMission(missionId, (mission) => {
            const status = resumePhase(mission);
            return {
              ...mission,
              endedAt: status === "completed" ? mission.endedAt : null,
              lastError: null,
              status,
            };
          });
        });
        const mission = this.get(missionId);
        const interrupted = this.#store.assignments
          .list(missionId, ["cancelled"])
          .filter(
            (assignment) =>
              !assignment.handoff && assignment.epoch === mission.epoch - 1
          );
        const orchestrator = this.#orchestrator(missionId);
        if (mission.status === "completed") {
          return mission;
        }
        // A goal still in the outbox was never sent; its own delivery is the restart.
        const goal = this.#store.queue.get(`${missionId}:goal`);
        const goalPending = goal?.state === "accepted";
        try {
          const runtime = await this.#ensureRuntime(orchestrator.id);
          this.#requireRuntime(orchestrator.id, runtime);
          if (!goalPending) {
            await this.#sendSystem(
              orchestrator.id,
              this.#resumeNotice(missionId, interrupted),
              "steer"
            );
          }
        } catch (error) {
          if (!FENCED.has(this.get(missionId).status)) {
            await this.#stopMission(missionId, "interrupted");
            if (this.get(missionId).status !== "stop_failed") {
              this.#fail(
                missionId,
                "environment",
                `Could not restart the Orchestrator: ${errorMessage(error)}`
              );
            }
          }
          throw conflict("Could not restart the Orchestrator");
        }
        for (const assignment of interrupted) {
          this.#saveAssignment({
            ...assignment,
            epoch: mission.epoch,
            status: "queued",
          });
        }
        await this.#pumpAssignments(missionId);
        this.#scheduleDelivery(orchestrator.id);
        return this.get(missionId);
      }
    );
    return result;
  }

  /** Resume context, including Plan revisions whose native approval ended with the stop. */
  #resumeNotice(missionId: string, interrupted: readonly Assignment[]) {
    const [ended] = this.#store.plans
      .list(missionId)
      .filter((plan) => plan.status === "proposed" && !plan.actionable)
      .toSorted((a, b) => b.revision - a.revision);
    return ended
      ? `${resumedMessage(interrupted)}\n\n${planReissueMessage(ended)}`
      : resumedMessage(interrupted);
  }

  /** Stop-failed missions must prove their recorded processes are gone before resuming. */
  async #confirmStopped(missionId: string) {
    const agents = this.#store.listAgents(missionId);
    const owners = agents.flatMap((agent) => {
      const owner = this.#live.get(agent.id);
      return owner ? [owner] : [];
    });
    for (const owner of owners) {
      owner.retirement = undefined;
    }
    const ownerResults = await Promise.all(
      owners.map((owner) => this.#closeRuntime(owner.agentId, owner))
    );
    const records = this.#processRecords.list(agents.map((agent) => agent.id));
    const results = await Promise.all(
      records.map((record) => this.#supervisor.stopRecord(record))
    );
    const failed = [...ownerResults, ...results].some(
      (result) => !result.stopped
    );
    if (failed) {
      const survivors = [...ownerResults, ...results].flatMap(
        (result) => result.survivors
      );
      throw conflict(
        `Agent processes are still running: ${survivors.join(", ")}`
      );
    }
    for (const record of records) {
      this.#processRecords.delete(record.agentId);
    }
  }

  // ------------------------------------------------------------ recovery

  /** Startup: nothing resumes on its own. Orphans are stopped and missions wait for Resume. */
  async recover() {
    const records = this.#processRecords.list();
    const stopped = await Promise.all(
      records.map(async (record) => ({
        agentId: record.agentId,
        result: await this.#supervisor.stopRecord(record),
      }))
    );
    const failedAgents = new Map(
      stopped
        .filter(({ result }) => !result.stopped)
        .map(({ agentId, result }) => [agentId, result])
    );
    for (const { agentId, result } of stopped) {
      if (result.stopped) {
        this.#processRecords.delete(agentId);
      }
    }
    for (const mission of this.#store.listMissions()) {
      const agents = this.#store.listAgents(mission.id);
      if (
        ACTIVE.has(mission.status) ||
        agents.some((agent) => failedAgents.has(agent.id))
      ) {
        this.#markInterrupted(mission.id, failedAgents);
      }
    }
    for (const request of this.#store.permissions.listByStatus(["pending"])) {
      this.#savePermission({
        ...request,
        decidedAt: this.#iso(),
        reason: "Daemon restarted",
        status: "stale",
      });
    }
    for (const question of this.#store.questions.listByStatus(["pending"])) {
      this.#saveQuestion({ ...question, status: "cancelled" });
    }
  }

  #markInterrupted(
    missionId: string,
    failedAgents: ReadonlyMap<string, StopResult>
  ) {
    const agents = this.#store.listAgents(missionId);
    const failed = agents.some((agent) => failedAgents.has(agent.id));
    const survivors = agents.flatMap(
      (agent) => failedAgents.get(agent.id)?.survivors ?? []
    );
    this.#mutateMission(missionId, (m) => ({
      ...m,
      epoch: m.epoch + 1,
      lastError: failed
        ? {
            code: "stop_failed",
            message: `Processes still running: ${survivors.join(", ")}`,
            retryAfterMs: null,
          }
        : m.lastError,
      status: failed ? "stop_failed" : "interrupted",
    }));
    this.#settleAfterStop(
      missionId,
      this.#store.listAgents(missionId).map((agent) => ({
        agent,
        result: failedAgents.get(agent.id) ?? {
          stopped: true,
          survivors: [],
        },
      }))
    );
    for (const agent of this.#store.listAgents(missionId)) {
      if (agent.status === "stopped") {
        this.#patchAgent(agent.id, { status: "interrupted" });
      }
    }
    this.#notice(
      missionId,
      failed ? "stop_failed" : "recovery_required",
      "warning",
      failed
        ? "Some agent processes survived restart. New work is blocked until Resume confirms they stopped."
        : "The daemon restarted. Review the mission and Resume to continue."
    );
  }

  /** Graceful daemon stop owns every cleanup attempt, even when another one fails. */
  shutdown(): Promise<void> {
    if (!this.#shutdownPromise) {
      this.#closing = true;
      this.#deltas.dispose();
      this.#shutdownPromise = Promise.resolve().then(() => this.#shutdownAll());
    }
    return this.#shutdownPromise;
  }

  async #shutdownAll(): Promise<void> {
    try {
      await this.#shutdownPhase(() =>
        this.#store
          .listMissionsByStatus([...ACTIVE])
          .map((mission) => this.#stopMission(mission.id, "interrupted"))
      );
    } finally {
      await this.#shutdownPhase(() =>
        [...this.#live.keys()].map(
          async (agentId) => await this.#closeRuntime(agentId)
        )
      );
      await this.#joinTasks();
      // An admitted creation may have persisted its mission after the first sweep.
      await this.#shutdownPhase(() =>
        this.#store
          .listMissionsByStatus([...ACTIVE])
          .map((mission) => this.#stopMission(mission.id, "interrupted"))
      );
      await this.#shutdownPhase(() =>
        [...this.#live.keys()].map(
          async (agentId) => await this.#closeRuntime(agentId)
        )
      );
      await this.#joinTasks();
    }
    if (this.#shutdownFailures.size > 0) {
      throw new AggregateError(
        [...this.#shutdownFailures],
        "Mission shutdown failed"
      );
    }
  }

  async #shutdownPhase(work: () => Promise<unknown>[]): Promise<void> {
    try {
      const results = await Promise.allSettled(work());
      for (const result of results) {
        if (result.status === "rejected") {
          this.#shutdownFailures.add(result.reason);
        }
      }
    } catch (error) {
      this.#shutdownFailures.add(error);
    }
  }

  async #joinTasks(): Promise<void> {
    const results = await Promise.allSettled(this.#tasks);
    for (const result of results) {
      if (result.status === "rejected") {
        this.#shutdownFailures.add(result.reason);
      }
    }
    if (this.#tasks.size > 0) {
      await this.#joinTasks();
    }
  }
}
