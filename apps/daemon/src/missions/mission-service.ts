import { randomUUID } from "node:crypto";

import type {
  AnswerQuestionRequest,
  ChangeQueueModeRequest,
  CreateMissionRequest,
  DecidePermissionRequest,
  DecidePlanRequest,
  EditQueueItemRequest,
  EditQueueItemResponse,
  MissionControlRequest,
  SubmitMessageRequest,
  UpdateMissionRequest,
} from "@missions/protocol/commands";
import {
  AnswerQuestionRequestSchema,
  CreateMissionRequestSchema,
} from "@missions/protocol/commands";
import type { DeliveryMode, Role } from "@missions/protocol/common";
import type { EventBody } from "@missions/protocol/events";
import type {
  Agent,
  AgentStatus,
  Assignment,
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
import { AppError, conflict, notFound, stale } from "../lib/app-error";
import { errorMessage } from "../lib/async";
import { PermissionBroker } from "../permissions/permission-broker";
import type { AgentContext } from "../permissions/permission-broker";
import { StaleDecisionError } from "../permissions/stale-decision-error";
import type {
  ProcessRecord,
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
  RemoveOutcome,
  RuntimeStartResult,
} from "../sdk/agent-runtime";
import type { NativeQueueEntry, NativeQueueTracker } from "../sdk/native-queue";
import {
  createRoleToolServer,
  DISABLED_TOOL_IDS,
  ENABLED_TOOL_IDS,
  ORCHESTRATOR_PROMPT,
  ROLE_TOOL_SERVER,
  WORKER_PROMPT,
} from "../sdk/role-tools";
import type { RoleToolHandlers, TodoInput } from "../sdk/role-tools";
import type { SettingsService } from "../settings/settings-service";
import { verifyBinding } from "../workspaces/workspace-service";
import type { WorkspaceService } from "../workspaces/workspace-service";
import { WriteLeaseRegistry } from "../workspaces/write-lease";
import {
  ACTIVE,
  assignmentMessage,
  FENCED,
  handoffMessage,
  isSystemRequest,
  MAX_PENDING_ASSIGNMENTS,
  planApprovedMessage,
  planRejectedMessage,
  RESUMABLE,
  resumedMessage,
  resumePhase,
  SNAPSHOT_TRANSCRIPT,
  SYSTEM_PREFIX,
  titleFromGoal,
  workerMessage,
} from "./messages";
import {
  DeltaCoalescer,
  itemsFromMessage,
  textItemId,
  toolCallItem,
  toolResultItem,
} from "./transcript";
import type { NewTranscriptItem } from "./transcript";

/** The subset of `AgentRuntime` the service drives; tests substitute a scripted runtime. */
export interface RuntimeHandle {
  readonly queue: NativeQueueTracker;
  readonly sessionId: string | null;
  start: (resumeSessionId?: string) => Promise<RuntimeStartResult>;
  submit: (id: string, text: string, mode: DeliveryMode) => Promise<void>;
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
  supervisor: ProcessSupervisor;
  createRuntime?: RuntimeFactory;
  now?: () => Date;
}

interface LiveAgent {
  runtime: RuntimeHandle;
  /** Mission epoch the runtime was started in; events from older epochs are ignored. */
  epoch: number;
}

interface PendingQuestion {
  resolve: (answer: AskUserAnswer) => void;
}

const PROCESS_PREFIX = "process:";
const TERMINAL_QUEUE = new Set<QueueItem["state"]>([
  "sent",
  "removed",
  "discarded",
  "failed",
]);

const isDefiniteFailure = (error: unknown) => error instanceof AppError;

/** Interrupt, then delete every native queued entry so nothing is delivered after a stop. */
const drainNative = async (runtime: RuntimeHandle) => {
  try {
    await runtime.interrupt();
  } catch {
    // Already idle or disconnected; queue deletion below still runs.
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
  readonly #supervisor: ProcessSupervisor;
  readonly #createRuntime: RuntimeFactory;
  readonly #now: () => Date;
  readonly broker: PermissionBroker;
  readonly leases: WriteLeaseRegistry;
  readonly #live = new Map<string, LiveAgent>();
  readonly #questions = new Map<string, PendingQuestion>();
  readonly #deltas: DeltaCoalescer;
  readonly #starting = new Map<string, Promise<RuntimeHandle>>();

  constructor(options: MissionServiceOptions) {
    this.#store = options.store;
    this.#log = options.log;
    this.#journal = options.journal;
    this.#projects = options.projects;
    this.#workspaces = options.workspaces;
    this.#settings = options.settings;
    this.#supervisor = options.supervisor;
    this.#createRuntime =
      options.createRuntime ??
      ((runtimeOptions) => new AgentRuntime(runtimeOptions));
    this.#now = options.now ?? (() => new Date());
    this.leases = new WriteLeaseRegistry((_workspace, holder) =>
      this.#onLeaseChange(holder)
    );
    this.broker = new PermissionBroker({
      acquireWriteLease: (agentId, signal) => {
        const workspace = this.#workspaceOf(agentId);
        if (!workspace) {
          return Promise.reject(new Error("No workspace"));
        }
        return this.leases.acquire(workspace, agentId, signal);
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
      if (agent) {
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
    const next = {
      ...mission,
      revision: mission.revision + 1,
      updatedAt: this.#iso(),
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
    if (request.agentId) {
      this.#patchAgent(request.agentId, {
        status: request.status === "pending" ? "waiting_permission" : "working",
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
      epoch: mission.epoch,
      fenced: FENCED.has(mission.status) || live.epoch !== mission.epoch,
      missionId: mission.id,
      planApproved: this.#store.plans.list(mission.id, ["approved"]).length > 0,
      projectId: mission.projectId,
      role: agent.role,
      workspacePath: mission.workspace.path,
    };
  }

  #onLeaseChange(holder: string | null) {
    const holderAgent = holder ? this.#store.getAgent(holder) : null;
    const missionId = holderAgent?.missionId;
    const agents = missionId ? this.#store.listAgents(missionId) : [];
    for (const agent of agents) {
      const holds = agent.id === holder;
      if (agent.holdsWriteLease !== holds) {
        this.#saveAgent({ ...agent, holdsWriteLease: holds });
      }
    }
    for (const live of this.#live.keys()) {
      const agent = this.#store.getAgent(live);
      if (
        agent?.holdsWriteLease &&
        agent.id !== holder &&
        !agents.some((a) => a.id === agent.id)
      ) {
        this.#saveAgent({ ...agent, holdsWriteLease: false });
      }
    }
  }

  // ------------------------------------------------------------- creation

  async create(input: CreateMissionRequest): Promise<MissionSnapshot> {
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
          epoch: 0,
          goal: request.goal,
          id,
          lastError: null,
          orchestrator: request.orchestrator ?? settings.orchestrator,
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
          status: "exploring",
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
        const goalItem = this.#newQueueItem(
          mission.id,
          orchestrator.id,
          `${mission.id}:goal`,
          request.goal,
          "steer"
        );
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
    void this.#launch(missionId);
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
      role,
      sessionId: null,
      status: "starting",
      title,
      updatedAt: at,
      workingState: null,
    };
  }

  #newQueueItem(
    missionId: string,
    agentId: string,
    id: string,
    text: string,
    mode: DeliveryMode
  ): QueueItem {
    const at = this.#iso();
    return {
      agentId,
      createdAt: at,
      error: null,
      id,
      missionId,
      mode,
      replacedById: null,
      replacesId: null,
      revision: 0,
      state: "submitting",
      text,
      updatedAt: at,
    };
  }

  async #launch(missionId: string) {
    const mission = this.get(missionId);
    const orchestrator = this.#store
      .listAgents(missionId)
      .find((agent) => agent.role === "orchestrator");
    const goal = this.#store.queue.get(`${missionId}:goal`);
    if (!(orchestrator && goal)) {
      return;
    }
    try {
      const runtime = await this.#ensureRuntime(orchestrator.id);
      await runtime.submit(goal.id, goal.text, "steer");
    } catch (error) {
      this.#fail(
        mission.id,
        "environment",
        `Could not start the Orchestrator: ${errorMessage(error)}`
      );
    }
  }

  #fail(
    missionId: string,
    code: "environment" | "run_failed",
    message: string
  ) {
    this.#mutateMission(missionId, (mission) => ({
      ...mission,
      lastError: { code, message, retryAfterMs: null },
      status:
        mission.status === "exploring" && code === "environment"
          ? "failed"
          : "interrupted",
    }));
    this.#notice(missionId, code, "error", message);
  }

  // ------------------------------------------------------------- runtimes

  #ensureRuntime(agentId: string): Promise<RuntimeHandle> {
    const live = this.#live.get(agentId);
    if (live) {
      return Promise.resolve(live.runtime);
    }
    const pending = this.#starting.get(agentId);
    if (pending) {
      return pending;
    }
    const started = this.#startRuntime(agentId).finally(() =>
      this.#starting.delete(agentId)
    );
    this.#starting.set(agentId, started);
    return started;
  }

  async #startRuntime(agentId: string): Promise<RuntimeHandle> {
    const agent = this.#store.getAgent(agentId);
    const mission = agent ? this.get(agent.missionId) : null;
    if (!(agent && mission?.workspace)) {
      throw notFound("Agent");
    }
    const runtime = this.#createRuntime({
      agentId,
      cwd: mission.workspace.path,
      disabledToolIds: DISABLED_TOOL_IDS,
      enabledToolIds: ENABLED_TOOL_IDS,
      mcpServers: [
        createRoleToolServer(agent.role, agentId, this.#roleHandlers()),
      ],
      modelId: agent.model.modelId,
      onAskUser: (ask) => this.#askUser(ask),
      onEvent: (event) => this.#onAgentEvent(agentId, event),
      onPermission: async (ask) => {
        const result = await this.broker.ask(ask.agentId, ask.toolUses);
        return result.approved;
      },
      reasoningEffort: agent.model.reasoningEffort,
      role: agent.role,
      supervisor: this.#supervisor,
      systemPrompt:
        agent.role === "orchestrator" ? ORCHESTRATOR_PROMPT : WORKER_PROMPT,
    });
    const live: LiveAgent = { epoch: mission.epoch, runtime };
    this.#live.set(agentId, live);
    try {
      const started = await runtime.start(agent.sessionId ?? undefined);
      if (agent.sessionId) {
        this.#reconcileQueue(agent, runtime, started);
      }
      this.#patchAgent(agentId, {
        sessionId: started.sessionId,
        status: "idle",
      });
      return runtime;
    } catch (error) {
      this.#live.delete(agentId);
      this.#patchAgent(agentId, { status: "failed" });
      await runtime.close().catch(() => null);
      throw error;
    }
  }

  /** After load, mirrored entries are compared with native state and never resubmitted. */
  #reconcileQueue(
    agent: Agent,
    runtime: RuntimeHandle,
    started: RuntimeStartResult
  ) {
    const open = this.#store.queue
      .list(agent.missionId)
      .filter(
        (item) => item.agentId === agent.id && !TERMINAL_QUEUE.has(item.state)
      );
    runtime.queue.hydrate(
      open.map((item) => ({
        error: item.error,
        id: item.id,
        mode: item.mode,
        state: item.state,
        text: item.text,
      }))
    );
    const consumedIds = new Set(
      started.messages
        .map((message) => message.requestId)
        .filter((id): id is string => id !== null)
    );
    runtime.queue.reconcile({
      consumedIds,
      pendingIds: started.pendingIds,
      queuedIds: started.queuedIds,
    });
  }

  async #closeRuntime(agentId: string): Promise<StopResult> {
    const live = this.#live.get(agentId);
    this.#live.delete(agentId);
    this.leases.forget(agentId);
    if (!live) {
      return { stopped: true, survivors: [] };
    }
    return await live.runtime.close();
  }

  // --------------------------------------------------------- agent events

  #isCurrent(agentId: string) {
    const live = this.#live.get(agentId);
    const agent = this.#store.getAgent(agentId);
    const mission = agent ? this.#store.getMission(agent.missionId) : null;
    return live && agent && mission && live.epoch === mission.epoch
      ? { agent, mission }
      : null;
  }

  #onAgentEvent(agentId: string, event: AgentEvent) {
    if (event.type === "queue") {
      this.#syncQueue(agentId, event.entry);
      return;
    }
    const current = this.#isCurrent(agentId);
    if (!current) {
      return;
    }
    const { agent, mission } = current;
    const base = { agentId, createdAt: this.#iso(), missionId: mission.id };
    switch (event.type) {
      case "text_delta":
      case "thinking_delta": {
        const kind = event.type === "text_delta" ? "text" : "thinking";
        this.#deltas.push(
          textItemId(agentId, event.messageId, kind),
          agentId,
          kind,
          event.delta
        );
        break;
      }
      case "message": {
        const items = itemsFromMessage(base, event.message).map((entry) =>
          entry.kind === "user" && isSystemRequest(entry.requestId)
            ? { ...entry, kind: "system" as const }
            : entry
        );
        this.#appendTranscript(mission.id, items);
        break;
      }
      case "tool_call": {
        this.#appendTranscript(mission.id, [
          toolCallItem(base, event.toolUseId, event.name, event.input),
        ]);
        break;
      }
      case "tool_result": {
        this.#appendTranscript(mission.id, [
          toolResultItem(base, event.toolUseId, event.content, event.isError),
        ]);
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
        this.#saveAgent({ ...agent, status, workingState: event.state });
        break;
      }
      case "turn_completed": {
        this.#deltas.flushAll();
        if (mission.workspace) {
          this.leases.release(mission.workspace.path, agent.id);
        }
        break;
      }
      case "retry": {
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
        this.#live.delete(agent.id);
        this.leases.forget(agent.id);
        this.#saveAgent({ ...agent, status: "failed" });
        if (agent.role === "orchestrator" && ACTIVE.has(mission.status)) {
          this.#fail(
            mission.id,
            "run_failed",
            `The Orchestrator stopped unexpectedly: ${event.message}`
          );
        }
        break;
      }
      default: {
        break;
      }
    }
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
    this.#patchAgent(ask.agentId, { status: "waiting_answer" });
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
    this.#patchAgent(question.agentId, { status: "working" });
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

  #cancelQuestions(missionId: string) {
    for (const question of this.#store.questions.list(missionId, ["pending"])) {
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
    const decided: PlanRevision = {
      ...plan,
      decidedAt: this.#iso(),
      feedback: request.feedback?.trim() || null,
      status: request.approve ? "approved" : "rejected",
    };
    this.#log.commit((emit) => {
      this.#savePlan(decided, emit);
      this.#saveMission(emit, {
        ...mission,
        status: request.approve ? "running" : "exploring",
      });
    });
    const orchestrator = this.#orchestrator(missionId);
    const text = request.approve
      ? planApprovedMessage(decided)
      : planRejectedMessage(decided, decided.feedback);
    void this.#systemSubmit(orchestrator.id, text, "steer");
    return decided;
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

  async #systemSubmit(agentId: string, text: string, mode: DeliveryMode) {
    try {
      const runtime = await this.#ensureRuntime(agentId);
      await runtime.submit(`${SYSTEM_PREFIX}${randomUUID()}`, text, mode);
    } catch (error) {
      const agent = this.#store.getAgent(agentId);
      if (agent) {
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

  #roleHandlers(): RoleToolHandlers {
    return {
      completeMission: (agentId, input) =>
        Promise.resolve(this.#completeMission(agentId, input)),
      dispatchWorker: (agentId, input) =>
        Promise.resolve(this.#dispatchWorker(agentId, input)),
      messageWorker: (agentId, input) => this.#messageWorker(agentId, input),
      proposePlan: (agentId, input) =>
        Promise.resolve(this.#proposePlan(agentId, input)),
      submitHandoff: (agentId, input) =>
        Promise.resolve(this.#submitHandoff(agentId, input)),
      updateTodos: (agentId, input) =>
        Promise.resolve(this.#updateTodos(agentId, input.todos)),
    };
  }

  #requireCurrent(agentId: string) {
    const current = this.#isCurrent(agentId);
    if (!current || FENCED.has(current.mission.status)) {
      throw new Error("The mission is paused; stop and wait for the user.");
    }
    return current;
  }

  #proposePlan(agentId: string, input: { title: string; markdown: string }) {
    const { mission } = this.#requireCurrent(agentId);
    const plans = this.#store.plans.list(mission.id);
    const plan: PlanRevision = {
      createdAt: this.#iso(),
      decidedAt: null,
      feedback: null,
      id: randomUUID(),
      markdown: input.markdown,
      missionId: mission.id,
      revision: Math.max(0, ...plans.map((p) => p.revision)) + 1,
      status: "proposed",
      title: input.title,
    };
    this.#log.commit((emit) => {
      for (const previous of plans.filter((p) => p.status === "proposed")) {
        this.#savePlan({ ...previous, status: "superseded" }, emit);
      }
      this.#savePlan(plan, emit);
      const approved = plans.some((p) => p.status === "approved");
      this.#saveMission(emit, {
        ...mission,
        status:
          approved && mission.status === "running"
            ? "running"
            : "awaiting_approval",
      });
    });
    return `Plan revision ${plan.revision} submitted for review. Wait for the user's decision; it arrives as a message. Do not change files until then.`;
  }

  #dispatchWorker(
    agentId: string,
    input: { title: string; instructions: string; needsWrite: boolean }
  ) {
    const { mission } = this.#requireCurrent(agentId);
    if (this.#store.plans.list(mission.id, ["approved"]).length === 0) {
      throw new Error(
        "Workers can only be dispatched after the user approves a plan."
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

  async #pumpAssignments(missionId: string) {
    const mission = this.get(missionId);
    if (FENCED.has(mission.status)) {
      return;
    }
    const limit = this.#settings.get().maxConcurrentWorkers;
    const running = this.#store.assignments.list(missionId, ["running"]).length;
    const next = this.#store.assignments
      .list(missionId, ["queued"])
      .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, Math.max(0, limit - running));
    await Promise.all(
      next.map((assignment) => this.#startAssignment(mission, assignment))
    );
  }

  async #startAssignment(mission: Mission, assignment: Assignment) {
    const workers = this.#store
      .listAgents(mission.id)
      .filter((a) => a.role === "worker").length;
    const worker = this.#newAgent(
      mission,
      "worker",
      `Worker ${workers + 1}`,
      assignment.id
    );
    this.#saveAgent(worker);
    this.#saveAssignment({
      ...assignment,
      status: "running",
      workerAgentId: worker.id,
    });
    try {
      const runtime = await this.#ensureRuntime(worker.id);
      await runtime.submit(
        `${SYSTEM_PREFIX}assign:${assignment.id}`,
        assignmentMessage(assignment),
        "steer"
      );
    } catch (error) {
      this.#saveAssignment({
        ...assignment,
        status: "failed",
        workerAgentId: worker.id,
      });
      void this.#systemSubmit(
        this.#orchestrator(mission.id).id,
        `[Missions] Assignment ${assignment.id} could not start: ${errorMessage(error)}`,
        "steer"
      );
    }
  }

  async #messageWorker(
    agentId: string,
    input: { assignmentId: string; text: string; mode: DeliveryMode }
  ) {
    const { mission } = this.#requireCurrent(agentId);
    const assignment = this.#store.assignments.get(input.assignmentId);
    if (
      !assignment ||
      assignment.missionId !== mission.id ||
      !assignment.workerAgentId
    ) {
      throw new Error(`Unknown or unstarted assignment ${input.assignmentId}`);
    }
    if (assignment.status !== "running") {
      throw new Error(
        `Assignment ${assignment.id} is ${assignment.status}; its Worker is not running.`
      );
    }
    const runtime = await this.#ensureRuntime(assignment.workerAgentId);
    await runtime.submit(
      `${SYSTEM_PREFIX}${randomUUID()}`,
      workerMessage(input.text),
      input.mode
    );
    return `Message ${input.mode === "steer" ? "steered" : "queued"} to the Worker on ${assignment.id}.`;
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
    const handed = this.#saveAssignment({
      ...assignment,
      handoff: input,
      status: "handed_off",
    });
    const orchestrator = this.#orchestrator(mission.id);
    void this.#systemSubmit(
      orchestrator.id,
      handoffMessage(agent.title, handed, input),
      "steer"
    );
    // The Worker finishes its turn after this tool returns; stop it then to free a slot.
    setTimeout(() => {
      void this.#retireWorker(agent.id, mission.id);
    }, 0);
    return "Handoff recorded. Stop now; the Orchestrator will review your work.";
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
    await this.#pumpAssignments(missionId);
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
    this.#mutateMission(mission.id, (m) => ({
      ...m,
      status: "completed",
      summary: checks
        ? `${input.summary}\n\nChecks:\n${checks}`
        : input.summary,
    }));
    return "Mission marked complete. The user will review and publish.";
  }

  // ---------------------------------------------------------------- queue

  async submitMessage(
    missionId: string,
    request: SubmitMessageRequest
  ): Promise<QueueItem> {
    const mission = this.get(missionId);
    const existing = this.#store.queue.get(request.operationId);
    if (existing) {
      return existing;
    }
    if (FENCED.has(mission.status)) {
      throw conflict("Resume the mission before sending messages");
    }
    const agent = request.agentId
      ? this.#store.getAgent(request.agentId)
      : this.#orchestrator(missionId);
    if (!agent || agent.missionId !== missionId) {
      throw notFound("Agent");
    }
    const item = this.#saveQueueItem(
      this.#newQueueItem(
        missionId,
        agent.id,
        request.operationId,
        request.text,
        request.mode
      )
    );
    try {
      const runtime = await this.#ensureRuntime(agent.id);
      await runtime.submit(item.id, item.text, item.mode);
    } catch (error) {
      const latest = this.#store.queue.get(item.id) ?? item;
      if (latest.state === "submitting") {
        this.#saveQueueItem({
          ...latest,
          error: errorMessage(error),
          revision: latest.revision + 1,
          state: isDefiniteFailure(error) ? "failed" : "unknown",
          updatedAt: this.#iso(),
        });
      }
    }
    return this.#store.queue.get(item.id) ?? item;
  }

  #queueItem(missionId: string, itemId: string, expectedRevision: number) {
    const item = this.#store.queue.get(itemId);
    if (!item || item.missionId !== missionId) {
      throw notFound("Queued message");
    }
    if (item.revision !== expectedRevision) {
      throw stale("This message changed; refresh and try again");
    }
    const live = this.#live.get(item.agentId);
    if (!live) {
      throw conflict("The agent for this message is not running");
    }
    return { item, runtime: live.runtime };
  }

  async changeQueueMode(
    missionId: string,
    itemId: string,
    request: ChangeQueueModeRequest
  ) {
    const { item, runtime } = this.#queueItem(
      missionId,
      itemId,
      request.expectedRevision
    );
    if (item.state !== "queued") {
      throw conflict(
        item.state === "sent"
          ? "This message was already delivered"
          : `Cannot change a ${item.state} message`
      );
    }
    try {
      await runtime.changeMode(item.id, request.mode);
    } catch (error) {
      throw conflict(`The runner refused the change: ${errorMessage(error)}`);
    }
    return this.#store.queue.get(item.id) ?? item;
  }

  async removeQueueItem(
    missionId: string,
    itemId: string,
    expectedRevision: number
  ) {
    const { item, runtime } = this.#queueItem(
      missionId,
      itemId,
      expectedRevision
    );
    if (TERMINAL_QUEUE.has(item.state)) {
      return item;
    }
    await runtime.remove(item.id);
    return this.#store.queue.get(item.id) ?? item;
  }

  async editQueueItem(
    missionId: string,
    itemId: string,
    request: EditQueueItemRequest
  ): Promise<EditQueueItemResponse> {
    const { item, runtime } = this.#queueItem(
      missionId,
      itemId,
      request.expectedRevision
    );
    if (item.state === "sent") {
      return { outcome: "already_sent", replacementId: null };
    }
    const replacementId = request.operationId;
    const outcome = await runtime.remove(item.id);
    if (outcome !== "removed") {
      return {
        outcome:
          outcome === "already_sent" ? "already_sent" : "delete_unconfirmed",
        replacementId: null,
      };
    }
    const replacement = {
      ...this.#newQueueItem(
        missionId,
        item.agentId,
        replacementId,
        request.text,
        item.mode
      ),
      replacesId: item.id,
    };
    this.#log.commit((emit) => {
      const removed = this.#store.queue.get(item.id) ?? item;
      const linked = {
        ...removed,
        replacedById: replacementId,
        revision: removed.revision + 1,
        updatedAt: this.#iso(),
      };
      this.#store.queue.put(linked);
      emit(missionId, { data: { item: linked }, type: "queue.updated" });
      this.#store.queue.put(replacement);
      emit(missionId, { data: { item: replacement }, type: "queue.updated" });
    });
    try {
      await runtime.submit(replacement.id, replacement.text, replacement.mode);
    } catch {
      // The tracker records failed/unknown on the replacement item.
    }
    return { outcome: "replaced", replacementId };
  }

  // --------------------------------------------------------- update/pause

  update(missionId: string, request: UpdateMissionRequest) {
    const mission = this.get(missionId);
    if (mission.revision !== request.expectedRevision) {
      throw stale("The mission changed; refresh and try again");
    }
    return this.#mutateMission(missionId, (m) => ({
      ...m,
      ...(request.autonomy ? { autonomy: request.autonomy } : {}),
      ...(request.title ? { title: request.title } : {}),
    }));
  }

  async pause(
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
          throw conflict(`Cannot pause a ${mission.status} mission`);
        }
        return await this.#stopMission(missionId, "paused");
      }
    );
    return result;
  }

  /** Fence → new epoch → settle waiters → interrupt → delete native queue → stop and confirm. */
  async #stopMission(
    missionId: string,
    target: "paused" | "interrupted"
  ): Promise<Mission> {
    this.#mutateMission(missionId, (m) => ({
      ...m,
      epoch: m.epoch + 1,
      status: "pausing",
    }));
    this.broker.cancelMission(missionId);
    this.#cancelQuestions(missionId);
    const agents = this.#store.listAgents(missionId);
    for (const agent of agents) {
      this.leases.forget(agent.id);
    }
    const live = agents.flatMap((agent) => {
      const entry = this.#live.get(agent.id);
      return entry ? [{ agent, runtime: entry.runtime }] : [];
    });
    await Promise.all(live.map(({ runtime }) => drainNative(runtime)));
    const results = await Promise.all(
      live.map(async ({ agent }) => ({
        agent,
        result: await this.#closeRuntime(agent.id),
      }))
    );
    const survivors = results.flatMap(({ result }) => result.survivors);
    this.#settleAfterStop(missionId, results);
    const mission = this.#mutateMission(missionId, (m) => ({
      ...m,
      lastError:
        survivors.length > 0
          ? {
              code: "stop_failed",
              message: `Processes still running: ${survivors.join(", ")}`,
              retryAfterMs: null,
            }
          : m.lastError,
      status: survivors.length > 0 ? "stop_failed" : target,
    }));
    if (survivors.length > 0) {
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
        holdsWriteLease: false,
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
      if (!TERMINAL_QUEUE.has(item.state) && item.state !== "unknown") {
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

  async resume(
    missionId: string,
    request: MissionControlRequest
  ): Promise<Mission> {
    const { result } = await this.#journal.run(
      { id: request.operationId, kind: "mission.resume", missionId },
      async () => {
        const mission = this.get(missionId);
        if (mission.revision !== request.expectedRevision) {
          throw stale("The mission changed; refresh and try again");
        }
        if (!RESUMABLE.has(mission.status)) {
          throw conflict(`Cannot resume a ${mission.status} mission`);
        }
        await this.#confirmStopped(missionId);
        const problems = mission.workspace
          ? await verifyBinding(mission.workspace)
          : ["The mission has no workspace"];
        if (problems.length > 0) {
          this.#notice(missionId, "environment", "error", problems.join(". "));
          throw conflict(problems.join(". "));
        }
        const interrupted = this.#store.assignments
          .list(missionId, ["cancelled"])
          .filter((a) => a.epoch < mission.epoch && !a.handoff);
        const next = this.#mutateMission(missionId, (m) => ({
          ...m,
          lastError: null,
          status: resumePhase(this.#store.plans.list(missionId), m),
        }));
        const orchestrator = this.#orchestrator(missionId);
        try {
          await this.#ensureRuntime(orchestrator.id);
        } catch (error) {
          this.#fail(
            missionId,
            "environment",
            `Could not restart the Orchestrator: ${errorMessage(error)}`
          );
          throw conflict("Could not restart the Orchestrator");
        }
        if (next.status !== "completed") {
          void this.#systemSubmit(
            orchestrator.id,
            resumedMessage(interrupted),
            "steer"
          );
        }
        return this.get(missionId);
      }
    );
    return result;
  }

  /** Stop-failed missions must prove their recorded processes are gone before resuming. */
  async #confirmStopped(missionId: string) {
    const agents = new Set(
      this.#store.listAgents(missionId).map((agent) => agent.id)
    );
    const records = this.#store
      .settingsWithPrefix<ProcessRecord>(PROCESS_PREFIX)
      .filter(({ value }) => agents.has(value.agentId));
    const results = await Promise.all(
      records.map(({ value }) => this.#supervisor.stopRecord(value))
    );
    const survivors = results.flatMap((r) => r.survivors);
    if (survivors.length > 0) {
      throw conflict(
        `Agent processes are still running: ${survivors.join(", ")}`
      );
    }
    for (const { key } of records) {
      this.#store.deleteSetting(key);
    }
  }

  /** Persists supervisor records so orphans from a crashed daemon can be stopped. */
  recordProcess(record: ProcessRecord | null, agentId: string) {
    if (record) {
      this.#store.putSetting(`${PROCESS_PREFIX}${agentId}`, record);
    } else {
      this.#store.deleteSetting(`${PROCESS_PREFIX}${agentId}`);
    }
  }

  // ------------------------------------------------------------ recovery

  /** Startup: nothing resumes on its own. Orphans are stopped and missions wait for Resume. */
  async recover() {
    const records =
      this.#store.settingsWithPrefix<ProcessRecord>(PROCESS_PREFIX);
    const stopped = await Promise.all(
      records.map(async ({ key, value }) => ({
        key,
        result: await this.#supervisor.stopRecord(value),
      }))
    );
    for (const { key, result } of stopped) {
      if (result.stopped) {
        this.#store.deleteSetting(key);
      }
    }
    for (const mission of this.#store.listMissionsByStatus([...ACTIVE])) {
      this.#markInterrupted(mission.id);
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

  #markInterrupted(missionId: string) {
    this.#mutateMission(missionId, (m) => ({
      ...m,
      epoch: m.epoch + 1,
      status: "interrupted",
    }));
    this.#settleAfterStop(
      missionId,
      this.#store
        .listAgents(missionId)
        .map((agent) => ({ agent, result: { stopped: true, survivors: [] } }))
    );
    for (const agent of this.#store.listAgents(missionId)) {
      if (agent.status === "stopped") {
        this.#patchAgent(agent.id, { status: "interrupted" });
      }
    }
    this.#notice(
      missionId,
      "recovery_required",
      "warning",
      "The daemon restarted. Review the mission and Resume to continue."
    );
  }

  /** Graceful daemon stop: runtimes close and active missions wait for Resume. */
  async shutdown() {
    this.#deltas.dispose();
    const missions = this.#store.listMissionsByStatus([...ACTIVE, "completed"]);
    await Promise.all(
      missions.map((mission) =>
        ACTIVE.has(mission.status)
          ? this.#stopMission(mission.id, "interrupted")
          : Promise.resolve(mission)
      )
    );
    await Promise.all(
      [...this.#live.keys()].map((agentId) => this.#closeRuntime(agentId))
    );
  }

  /** For tests and diagnostics. */
  isLive(agentId: string) {
    return this.#live.has(agentId);
  }

  ensureAgentRuntime(agentId: string) {
    return this.#ensureRuntime(agentId);
  }
}
