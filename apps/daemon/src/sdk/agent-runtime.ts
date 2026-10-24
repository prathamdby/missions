import {
  DroidClient,
  ProcessTransport,
  ToolConfirmationOutcome,
} from "@factory/droid-sdk/node";
import type {
  DroidClientTransport,
  SdkMcpServer,
} from "@factory/droid-sdk/node";
import type {
  DeliveryMode,
  ReasoningEffort,
  Role,
} from "@missions/protocol/common";
import { AgentModelSettingsSchema } from "@missions/protocol/missions";
import type { AgentModelSettings } from "@missions/protocol/missions";
import type { ModelOption } from "@missions/protocol/settings";

import { errorMessage, sleep } from "../lib/async";
import type {
  ProcessSupervisor,
  StopResult,
} from "../processes/process-supervisor";
import { toModelOption } from "../settings/models";
import { NativeQueueTracker } from "./native-queue";
import type { NativeQueueEntry } from "./native-queue";
import { SESSION_START_TIMEOUT_MS, withDeadline } from "./startup";

/** SDK placement for each UI delivery mode. */
export const PLACEMENT = {
  queue: "end_of_loop",
  steer: "end_of_turn",
} as const satisfies Record<DeliveryMode, string>;

export interface PermissionToolUse {
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  confirmationType: string;
  details: Record<string, unknown>;
}

export interface PermissionAsk {
  agentId: string;
  toolUses: PermissionToolUse[];
}

export interface AskUserAsk {
  agentId: string;
  toolCallId: string;
  questions: {
    index: number;
    topic: string;
    question: string;
    options: string[];
    multiSelect: boolean;
  }[];
}

export interface AskUserAnswer {
  cancelled: boolean;
  answers: { index: number; question: string; answer: string }[];
}

/** Structured native sender of an agent-to-agent message. */
export type RuntimeSender =
  | { kind: "orchestrator"; sessionId: string }
  | { kind: "agent"; sessionId: string; title: string };

export interface SubmitOptions {
  /** Server-bound sender identity; absent for user and daemon messages. */
  sender?: RuntimeSender;
}

export interface RuntimeMessage {
  id: string;
  role: "user" | "assistant" | "system";
  sender: RuntimeSender | null;
  text: string;
  thinking: string;
  toolUses: { id: string; name: string; input: Record<string, unknown> }[];
  toolResults: { toolUseId: string; content: string; isError: boolean }[];
  requestId: string | null;
}

export type AgentEvent =
  | { type: "text_delta"; messageId: string; delta: string }
  | { type: "thinking_delta"; messageId: string; delta: string }
  | { type: "message"; message: RuntimeMessage }
  | {
      type: "tool_call";
      toolUseId: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: "tool_result";
      toolUseId: string;
      content: string;
      isError: boolean;
    }
  | { type: "tool_progress"; toolUseId: string; toolName: string; text: string }
  | { type: "working_state"; state: string }
  | { type: "turn_completed"; reason: string; turnId: string | null }
  | { type: "queue"; entry: NativeQueueEntry }
  | { type: "retry"; reason: string; attempt: number }
  | { type: "error"; message: string; errorType: string | null }
  | { type: "title"; title: string }
  | { type: "process_exit"; message: string };

export interface AgentRuntimeOptions {
  agentId: string;
  role: Role;
  cwd: string;
  modelId: string;
  reasoningEffort: ReasoningEffort | null;
  systemPrompt?: string;
  mcpServers?: SdkMcpServer[];
  disabledToolIds?: string[];
  enabledToolIds?: string[];
  supervisor: ProcessSupervisor;
  onEvent: (event: AgentEvent) => void;
  onPermission: (ask: PermissionAsk) => Promise<boolean>;
  onAskUser: (ask: AskUserAsk) => Promise<AskUserAnswer>;
  /** Test seam: a fake transport exercises the adapter, not CLI scheduling. */
  createTransport?: () => DroidClientTransport | Promise<DroidClientTransport>;
  extraEnv?: Record<string, string>;
  /**
   * Per-session MCP readiness gating for agent turns. Omitted keeps the
   * user's settings.json default.
   */
  blockOnMcpLoad?: boolean;
  /** Content-free startup stage timings. */
  onTiming?: (
    stage: string,
    detail: Record<string, string | number | boolean | null>
  ) => void;
}

export interface RuntimeStartResult {
  sessionId: string;
  cwd: string | null;
  messages: RuntimeMessage[];
  queuedIds: string[] | undefined;
  pendingIds: string[] | undefined;
  workingState: string | null;
}

export type RemoveOutcome = "removed" | "already_sent" | "unconfirmed";
export type EditOutcome = "replaced" | "already_sent" | "delete_unconfirmed";

const CONSUMPTION_GRACE_MS = 400;
const CLEANUP_TIMEOUT_MS = 1000;

const boundedCleanup = async (cleanup: Promise<unknown>) => {
  const timeout = Promise.withResolvers<undefined>();
  const timer = setTimeout(
    () => timeout.resolve(undefined),
    CLEANUP_TIMEOUT_MS
  );
  try {
    await Promise.race([cleanup, timeout.promise]);
  } finally {
    clearTimeout(timer);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const str = (value: unknown) => (typeof value === "string" ? value : "");

const blockText = (content: unknown): string => {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) =>
      isRecord(block) && block.type === "text" ? str(block.text) : ""
    )
    .filter(Boolean)
    .join("\n");
};

const senderOf = (raw: unknown): RuntimeSender | null => {
  if (!isRecord(raw) || typeof raw.sessionId !== "string") {
    return null;
  }
  if (raw.kind === "orchestrator") {
    return { kind: "orchestrator", sessionId: raw.sessionId };
  }
  if (raw.kind === "agent" && typeof raw.title === "string") {
    return { kind: "agent", sessionId: raw.sessionId, title: raw.title };
  }
  return null;
};

export const normalizeMessage = (
  raw: unknown,
  requestId: string | null
): RuntimeMessage | null => {
  if (!isRecord(raw) || raw.visibility === "llm_only") {
    return null;
  }
  const role =
    raw.role === "assistant" || raw.role === "system" ? raw.role : "user";
  const content = Array.isArray(raw.content) ? raw.content : [];
  const message: RuntimeMessage = {
    id: str(raw.id),
    requestId:
      requestId ?? (typeof raw.requestId === "string" ? raw.requestId : null),
    role,
    sender: senderOf(raw.sender),
    text: "",
    thinking: "",
    toolResults: [],
    toolUses: [],
  };
  const texts: string[] = [];
  const thoughts: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) {
      continue;
    }
    if (block.type === "text") {
      texts.push(str(block.text));
    } else if (block.type === "thinking") {
      thoughts.push(str(block.thinking));
    } else if (block.type === "tool_use") {
      message.toolUses.push({
        id: str(block.id),
        input: isRecord(block.input) ? block.input : {},
        name: str(block.name),
      });
    } else if (block.type === "tool_result") {
      message.toolResults.push({
        content: blockText(block.content),
        isError: block.isError === true,
        toolUseId: str(block.toolUseId),
      });
    }
  }
  message.text = texts.join("\n");
  message.thinking = thoughts.join("\n");
  const empty =
    message.text === "" &&
    message.thinking === "" &&
    message.toolUses.length === 0 &&
    message.toolResults.length === 0;
  return empty ? null : message;
};

const optionalString = (value: unknown) =>
  typeof value === "string" ? value : null;

const stringList = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : undefined;

type Notification = Record<string, unknown>;

/** Pure notification-to-event mappings; stateful ones live on the runtime. */
const NOTIFICATION_EVENTS: Record<
  string,
  (n: Notification) => AgentEvent | null
> = {
  agent_turn_completed: (n) => ({
    reason: str(n.reason),
    turnId: optionalString(n.turnId),
    type: "turn_completed",
  }),
  assistant_text_delta: (n) => ({
    delta: str(n.textDelta),
    messageId: str(n.messageId),
    type: "text_delta",
  }),
  droid_working_state_changed: (n) => ({
    state: str(n.newState),
    type: "working_state",
  }),
  error: (n) => ({
    errorType: optionalString(n.errorType),
    message: str(n.message),
    type: "error",
  }),
  llm_retry: (n) => ({
    attempt: Number(n.attempt) || 0,
    reason: str(n.reason),
    type: "retry",
  }),
  session_title_updated: (n) => ({ title: str(n.title), type: "title" }),
  thinking_text_delta: (n) => ({
    delta: str(n.textDelta),
    messageId: str(n.messageId),
    type: "thinking_delta",
  }),
  tool_call: (n) => {
    const toolUse = isRecord(n.toolUse) ? n.toolUse : {};
    return {
      input: isRecord(toolUse.input) ? toolUse.input : {},
      name: str(toolUse.name),
      toolUseId: str(toolUse.id),
      type: "tool_call",
    };
  },
  tool_progress_update: (n) => {
    const update = isRecord(n.update) ? n.update : {};
    const text = str(update.text) || str(update.details) || str(update.status);
    return text
      ? {
          text,
          toolName: str(n.toolName),
          toolUseId: str(n.toolUseId),
          type: "tool_progress",
        }
      : null;
  },
  tool_result: (n) => ({
    content: blockText(n.content),
    isError: n.isError === true,
    toolUseId: str(n.toolUseId),
    type: "tool_result",
  }),
};
/** Protocol rejections are definite; transport failures leave outcomes unknown. */
const isDefiniteRejection = (error: unknown) =>
  error instanceof Error &&
  error.name === "ProtocolError" &&
  "metadata" in error &&
  isRecord(error.metadata) &&
  typeof error.metadata.code === "number";

/**
 * Owns one agent's public SDK connection: one `ProcessTransport` and one
 * `DroidClient`, initialized in the shared mission directory with
 * `worktree: false`. Queue and Steer are native `addUserMessage` placements.
 */
export class AgentRuntime {
  readonly options: AgentRuntimeOptions;
  readonly queue: NativeQueueTracker;
  #client: DroidClient | null = null;
  #transport: DroidClientTransport | null = null;
  #sessionId: string | null = null;
  #unsubscribers: (() => void)[] = [];
  #closing = false;
  #started = false;
  #startupExpired = false;
  #resourceVersion = 0;
  #closeVersion = -1;
  #closePromise: Promise<StopResult> | null = null;
  readonly #restoredRequestIds = new Map<string, string | null>();
  #model: AgentModelSettings | null = null;
  #settingsVersion = 0;
  readonly #models = new Map<string, ModelOption>();
  #availableModels: unknown[] = [];

  constructor(options: AgentRuntimeOptions) {
    this.options = options;
    this.queue = new NativeQueueTracker((entry) =>
      options.onEvent({ entry, type: "queue" })
    );
  }

  get sessionId() {
    return this.#sessionId;
  }

  get model() {
    return this.#model;
  }

  get connected() {
    return this.#client?.isConnected ?? false;
  }

  /** Raw model metadata the session reported; feeds the shared catalog. */
  get availableModels(): readonly unknown[] {
    return this.#availableModels;
  }

  #observeTransport(transport: DroidClientTransport): DroidClientTransport {
    return {
      close: () => transport.close(),
      get isConnected() {
        return transport.isConnected;
      },
      onError: (handler) => transport.onError(handler),
      onMessage: (handler) =>
        transport.onMessage((message) => {
          if (this.#closing) {
            return;
          }
          // SDK 0.10's transcript schema strips requestId. Preserve only
          // explicit wire identities before validation, never infer from text
          // or assume a message ID is also its request ID.
          if (message.type === "response" && isRecord(message.result)) {
            const { session } = message.result;
            if (isRecord(session) && Array.isArray(session.messages)) {
              this.#captureRestoredIds(session.messages);
            }
          }
          handler(message);
        }),
      send: (message) => transport.send(message),
    };
  }

  #captureRestoredIds(messages: unknown[]) {
    this.#restoredRequestIds.clear();
    for (const raw of messages) {
      if (!isRecord(raw) || typeof raw.id !== "string") {
        continue;
      }
      const requestId =
        typeof raw.requestId === "string" ? raw.requestId : null;
      const previous = this.#restoredRequestIds.get(raw.id);
      // Conflicting identities are not evidence of consumption.
      this.#restoredRequestIds.set(
        raw.id,
        previous !== undefined && previous !== requestId ? null : requestId
      );
    }
  }

  #takeRestoredMessages(result: Record<string, unknown>) {
    const session = isRecord(result.session) ? result.session : {};
    const rawMessages: unknown[] = Array.isArray(session.messages)
      ? session.messages
      : [];
    const messages = rawMessages
      .map((raw) =>
        normalizeMessage(
          raw,
          isRecord(raw)
            ? (this.#restoredRequestIds.get(str(raw.id)) ?? null)
            : null
        )
      )
      .filter((message): message is RuntimeMessage => message !== null);
    this.#restoredRequestIds.clear();
    return messages;
  }

  async #createTransport(): Promise<DroidClientTransport> {
    if (this.options.createTransport) {
      return this.options.createTransport();
    }
    const { supervisor, agentId, cwd } = this.options;
    const launcher = await supervisor.ensureLauncher();
    this.#assertStarting();
    return new ProcessTransport({
      cwd,
      droidExecPath: launcher,
      env: {
        ...supervisor.launchEnv(agentId),
        FACTORY_UPSTREAM_CLIENT_TYPE: "sdk",
        ...this.options.extraEnv,
      },
      onSpawned: (child) => {
        this.#resourceVersion += 1;
        supervisor.register(agentId, child);
      },
    });
  }

  #registerHandlers(client: DroidClient) {
    const { agentId, onPermission, onAskUser, onEvent } = this.options;
    client.setPermissionHandler(async (event) => {
      const { params } = event;
      const toolUses: PermissionToolUse[] = params.toolUses.map((use) => ({
        confirmationType: String(use.confirmationType),
        details: use.details as Record<string, unknown>,
        input: use.toolUse.input,
        toolName: use.toolUse.name,
        toolUseId: use.toolUse.id,
      }));
      const offered = new Set(params.options.map((option) => option.value));
      let approved = false;
      try {
        approved = await onPermission({ agentId, toolUses });
      } catch {
        approved = false;
      }
      // Never answer with a persistent "always" outcome: grants live in the
      // broker so plan, publish, and Pause gates keep applying.
      if (approved && offered.has(ToolConfirmationOutcome.ProceedOnce)) {
        return ToolConfirmationOutcome.ProceedOnce;
      }
      return ToolConfirmationOutcome.Cancel;
    });
    client.setAskUserHandler(async (event) => {
      const { toolCallId, questions } = event.params;
      try {
        return await onAskUser({
          agentId,
          questions: questions.map((question) => ({
            index: question.index,
            multiSelect: question.multiSelect === true,
            options: question.options,
            question: question.question,
            topic: question.topic,
          })),
          toolCallId,
        });
      } catch {
        return { answers: [], cancelled: true };
      }
    });
    this.#unsubscribers.push(
      client.onNotification((notification) =>
        this.#onNotification(notification)
      ),
      client.onError((failure) => {
        if (!this.#closing) {
          onEvent({ message: errorMessage(failure), type: "process_exit" });
        }
      })
    );
  }

  #onNotification(raw: Record<string, unknown>) {
    if (this.#closing) {
      return;
    }
    const params = isRecord(raw.params) ? raw.params : raw;
    const n = isRecord(params.notification) ? params.notification : params;
    const type = str(n.type);
    if (type === "settings_updated") {
      this.#captureSettings(n.settings);
      return;
    }
    if (type === "create_message") {
      this.#onCreateMessage(n);
      return;
    }
    if (type === "queued_messages_discarded") {
      this.queue.discarded(
        optionalString(n.requestId) ?? undefined,
        str(n.text)
      );
      return;
    }
    const event = NOTIFICATION_EVENTS[type]?.(n);
    if (event) {
      this.options.onEvent(event);
    }
  }
  #onCreateMessage(n: Record<string, unknown>) {
    const requestId = typeof n.requestId === "string" ? n.requestId : null;
    const message = normalizeMessage(n.message, requestId);
    if (!message) {
      return;
    }
    if (message.role === "user" && message.requestId) {
      this.queue.consumed(message.requestId);
    }
    this.options.onEvent({ message, type: "message" });
  }

  async start(resumeSessionId?: string): Promise<RuntimeStartResult> {
    if (this.#started) {
      throw new Error("Runtime already started");
    }
    this.#assertStarting();
    this.#started = true;
    this.#restoredRequestIds.clear();
    try {
      const transport = await this.#startupStage(async () => {
        const created = await this.#createTransport();
        this.#transport = created;
        return created;
      }, "transport creation");
      // Adoption precedes cancellation checks: even a late factory result
      // belongs to this runtime and invalidates earlier disposal evidence.
      this.#assertStarting();
      const client = new DroidClient({
        sessionInitTimeout: SESSION_START_TIMEOUT_MS,
        transport: this.#observeTransport(transport),
      });
      this.#client = client;
      this.#registerHandlers(client);
      if (transport instanceof ProcessTransport) {
        await this.#startupStage(
          () => transport.connect(),
          "process connection",
          transport
        );
        this.#assertStarting();
      }
      const mcpServers = await this.#startupStage(
        () => this.#startMcpServers(),
        "mission tool server startup"
      );
      this.#assertStarting();
      const result = await this.#startupStage(
        () =>
          resumeSessionId
            ? this.#load(client, resumeSessionId, mcpServers)
            : this.#initialize(client, mcpServers),
        resumeSessionId ? "session loading" : "session initialization"
      );
      this.#assertStarting();
      return result;
    } catch (error) {
      const cancelled = this.#closing;
      await this.close();
      if (cancelled) {
        throw new Error("Runtime startup was cancelled", { cause: error });
      }
      throw error;
    }
  }

  #assertStarting() {
    if (this.#closing) {
      throw new Error("Runtime startup was cancelled");
    }
  }

  async #startupStage<T>(
    effect: () => Promise<T>,
    stage: string,
    transport?: DroidClientTransport
  ): Promise<T> {
    const startedAt = Date.now();
    const timingStage = `startup.${stage.replaceAll(" ", "_")}`;
    const operation = effect().finally(async () => {
      // Connect can finish after its first close, creating a managed process
      // that the previous disposal never owned. Re-adopt it for another pass.
      if (transport) {
        this.#transport = transport;
      }
      this.#resourceVersion += 1;
      // A factory may resolve after its deadline/close. Its resources still
      // belong to us, not to a successor generation or an abandoned promise.
      if (this.#startupExpired) {
        await this.close();
      }
    });
    const message = `Droid ${stage} timed out after 120 seconds. Check Droid sign-in and configured MCP servers (a slow or disconnected server can block initialization), then Resume to retry. No new mission turn was sent by this startup attempt.`;
    try {
      const value = await withDeadline(
        operation,
        SESSION_START_TIMEOUT_MS,
        message
      );
      this.options.onTiming?.(timingStage, {
        durationMs: Date.now() - startedAt,
        ok: true,
      });
      return value;
    } catch (error) {
      this.options.onTiming?.(timingStage, {
        durationMs: Date.now() - startedAt,
        ok: false,
      });
      this.#startupExpired = true;
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new Error(message, { cause: error });
      }
      throw error;
    }
  }

  #captureSettings(raw: unknown) {
    if (!isRecord(raw) || !("modelId" in raw || "reasoningEffort" in raw)) {
      return;
    }
    const modelId =
      typeof raw.modelId === "string" ? raw.modelId : this.#model?.modelId;
    const model = modelId ? this.#models.get(modelId) : undefined;
    const noEffort = model?.supportedReasoningEfforts.length === 0;
    let { reasoningEffort } = raw;
    if (
      noEffort &&
      (reasoningEffort === undefined || reasoningEffort === "none")
    ) {
      // The wire uses "none" in full settings; model-only patches can omit it.
      reasoningEffort = null;
    } else if (reasoningEffort === undefined) {
      reasoningEffort =
        modelId === this.#model?.modelId ? this.#model?.reasoningEffort : null;
    }
    const parsed = AgentModelSettingsSchema.safeParse({
      modelId,
      reasoningEffort,
    });
    if (parsed.success) {
      this.#model = parsed.data;
      this.#settingsVersion += 1;
    }
  }

  #captureModels(raw: unknown) {
    if (!Array.isArray(raw)) {
      return;
    }
    this.#availableModels = raw;
    for (const entry of raw) {
      const model = toModelOption(entry);
      if (model) {
        this.#models.set(model.id, model);
      }
    }
  }

  async #startMcpServers() {
    // Join every admitted start, including siblings of a failed server, so
    // startup cannot settle before a late server has an owned cleanup pass.
    const outcomes = await Promise.allSettled(
      (this.options.mcpServers ?? []).map(async (server) => {
        this.#assertStarting();
        try {
          return server.config ?? (await server.start());
        } finally {
          this.#resourceVersion += 1;
          if (this.#startupExpired) {
            await this.close();
          }
        }
      })
    );
    return outcomes.map((outcome) => {
      if (outcome.status === "rejected") {
        throw outcome.reason;
      }
      return outcome.value;
    });
  }

  async #initialize(
    client: DroidClient,
    mcpServers: NonNullable<
      Parameters<DroidClient["initializeSession"]>[0]["mcpServers"]
    >
  ): Promise<RuntimeStartResult> {
    const {
      cwd,
      modelId,
      reasoningEffort,
      systemPrompt,
      disabledToolIds,
      enabledToolIds,
      blockOnMcpLoad,
    } = this.options;
    const response = await client.initializeSession({
      // Keep SDK autonomyLevel off: only the broker enforces the fixed High
      // policy. SDK high would bypass it, breaking Plan mode and Pause.
      autonomyLevel: "off" as never,
      cwd,
      machineId: "default",
      mcpServers,
      modelId,
      worktree: false,
      ...(reasoningEffort ? { reasoningEffort: reasoningEffort as never } : {}),
      ...(systemPrompt
        ? {
            systemPrompt: {
              append: systemPrompt,
              preset: "droid",
              type: "preset",
            } as never,
          }
        : {}),
      ...(disabledToolIds?.length ? { disabledToolIds } : {}),
      ...(enabledToolIds?.length ? { enabledToolIds } : {}),
      ...(blockOnMcpLoad === undefined ? {} : { blockOnMcpLoad }),
    });
    this.#assertStarting();
    const result: unknown = response.result;
    if (!isRecord(result) || typeof result.sessionId !== "string") {
      throw new Error("initializeSession returned no session ID");
    }
    this.#sessionId = result.sessionId;
    this.#captureModels(result.availableModels);
    this.#captureSettings(result.settings);
    const worktree = isRecord(result.worktree) ? str(result.worktree.path) : "";
    return {
      cwd: worktree || cwd,
      messages: this.#takeRestoredMessages(result),
      pendingIds: undefined,
      queuedIds: undefined,
      sessionId: result.sessionId,
      workingState: null,
    };
  }

  async #load(
    client: DroidClient,
    sessionId: string,
    mcpServers: NonNullable<
      Parameters<DroidClient["loadSession"]>[0]["mcpServers"]
    >
  ): Promise<RuntimeStartResult> {
    const response = await client.loadSession({ mcpServers, sessionId });
    this.#assertStarting();
    const result: unknown = response.result;
    if (!isRecord(result)) {
      throw new Error("loadSession returned no result");
    }
    this.#sessionId = sessionId;
    this.#captureModels(result.availableModels);
    this.#captureSettings(result.settings);
    const messages = this.#takeRestoredMessages(result);
    const queued: unknown[] | undefined = Array.isArray(result.queuedMessages)
      ? result.queuedMessages
      : undefined;
    return {
      cwd: typeof result.cwd === "string" ? result.cwd : null,
      messages,
      pendingIds: stringList(result.pendingMessageRequestIds),
      queuedIds: queued?.map((entry) =>
        isRecord(entry) ? str(entry.requestId) : ""
      ),
      sessionId,
      workingState:
        typeof result.workingState === "string" ? result.workingState : null,
    };
  }

  #requireClient() {
    if (!this.#client) {
      throw new Error("Agent runtime is not connected");
    }
    return this.#client;
  }

  /** Native in-place session settings: no interrupt, replacement or replay. */
  async updateModel(choice: AgentModelSettings): Promise<AgentModelSettings> {
    this.#assertStarting();
    const client = this.#requireClient();
    const model = this.#models.get(choice.modelId);
    if (
      choice.reasoningEffort !== null &&
      model &&
      !model.supportedReasoningEfforts.includes(choice.reasoningEffort)
    ) {
      throw new Error(
        `${model.displayName} does not support ${choice.reasoningEffort} reasoning`
      );
    }
    const reasoningEffort =
      choice.reasoningEffort ?? model?.defaultReasoningEffort ?? null;
    const desired = { modelId: choice.modelId, reasoningEffort };
    const version = this.#settingsVersion;
    await client.updateSessionSettings({
      modelId: desired.modelId,
      ...(reasoningEffort === null
        ? {}
        : { reasoningEffort: reasoningEffort as never }),
    });
    this.#assertStarting();
    // Like the SDK session handle, prefer authoritative settings_updated
    // notifications; older CLIs confirm the explicit fields with an empty ack.
    if (version === this.#settingsVersion) {
      if (
        reasoningEffort === null &&
        model?.supportedReasoningEfforts.length !== 0
      ) {
        throw new Error("Droid did not confirm its default model settings");
      }
      this.#model = desired;
    }
    if (!this.#model) {
      throw new Error("Droid did not confirm its current model settings");
    }
    return this.#model;
  }

  /**
   * Submits to the native queue; `id` is the stable SDK request ID. Agent
   * messages carry the SDK's structured sender, never a text prefix
   * the recipient would have to trust.
   */
  async submit(
    id: string,
    text: string,
    mode: DeliveryMode,
    options: SubmitOptions = {}
  ) {
    const client = this.#requireClient();
    this.queue.submitted(id, text, mode);
    try {
      await client.addUserMessage(
        {
          queuePlacement: PLACEMENT[mode] as never,
          text,
          ...(options.sender ? { sender: options.sender as never } : {}),
        },
        id
      );
      this.queue.admitted(id);
    } catch (error) {
      this.queue.submitFailed(
        id,
        errorMessage(error),
        isDefiniteRejection(error)
      );
      throw error;
    }
  }

  /**
   * Model-only context (for example planning guidance): a system message the
   * user never sees that does not start an agent loop by itself.
   */
  async addContext(id: string, text: string) {
    await this.#requireClient().addUserMessage(
      {
        role: "system" as never,
        skipAgentLoop: true,
        text,
        visibility: "llm_only" as never,
      },
      id
    );
  }

  /** Native Spec mode is the read-only planning mode; Auto is normal work. */
  async setInteractionMode(mode: "auto" | "spec") {
    this.#assertStarting();
    await this.#requireClient().updateSessionSettings({
      interactionMode: mode as never,
    });
  }

  async changeMode(id: string, mode: DeliveryMode) {
    const client = this.#requireClient();
    await client.resolveQueuedUserMessage({
      action: "update_queue" as never,
      queuePlacement: PLACEMENT[mode] as never,
      requestId: id,
    });
    this.queue.modeChanged(id, mode);
  }

  async remove(id: string): Promise<RemoveOutcome> {
    const release = this.queue.retain(id);
    try {
      return await this.#remove(id);
    } finally {
      release();
    }
  }

  async #remove(id: string): Promise<RemoveOutcome> {
    const client = this.#requireClient();
    if (this.queue.get(id)?.state === "sent") {
      return "already_sent";
    }
    this.queue.removing(id);
    try {
      await client.resolveQueuedUserMessage({
        action: "delete" as never,
        requestId: id,
      });
    } catch (error) {
      // A consumption notification can trail the failed delete response.
      await sleep(CONSUMPTION_GRACE_MS);
      if (this.queue.get(id)?.state === "sent") {
        return "already_sent";
      }
      this.queue.removeFailed(id, errorMessage(error));
      return "unconfirmed";
    }
    if (this.queue.get(id)?.state === "sent") {
      return "already_sent";
    }
    this.queue.removeConfirmed(id);
    return "removed";
  }

  /**
   * Cancel-and-requeue: no atomic replacement exists natively, so the edit
   * takes a new admission position and a new request ID.
   */
  async edit(
    id: string,
    replacementId: string,
    text: string
  ): Promise<EditOutcome> {
    const release = this.queue.retain(id);
    try {
      const mode = this.queue.get(id)?.mode ?? "steer";
      const removed = await this.#remove(id);
      if (removed === "already_sent" || this.queue.get(id)?.state === "sent") {
        return "already_sent";
      }
      if (removed === "unconfirmed") {
        return "delete_unconfirmed";
      }
      await this.submit(replacementId, text, mode);
      return "replaced";
    } finally {
      release();
    }
  }

  async interrupt() {
    await this.#requireClient().interruptSession();
  }

  /** Bounds client/MCP cleanup and independently confirms process disposal. */
  async close(): Promise<StopResult> {
    this.#closing = true;
    if (!this.#closePromise) {
      this.#closeVersion = this.#resourceVersion;
      this.#closePromise = this.#dispose();
    }
    const disposing = this.#closePromise;
    const version = this.#closeVersion;
    const [outcome] = await Promise.allSettled([disposing]);
    if (version !== this.#resourceVersion) {
      if (this.#closePromise === disposing) {
        this.#closePromise = null;
      }
      return await this.close();
    }
    if (outcome.status === "rejected") {
      if (this.#closePromise === disposing) {
        this.#closePromise = null;
      }
      throw outcome.reason;
    }
    if (!outcome.value.stopped && this.#closePromise === disposing) {
      this.#closePromise = null;
    }
    return outcome.value;
  }

  async #dispose(): Promise<StopResult> {
    this.#closing = true;
    this.#restoredRequestIds.clear();
    for (const unsubscribe of this.#unsubscribers.splice(0)) {
      try {
        unsubscribe();
      } catch {
        // A broken listener must not prevent process supervision.
      }
    }
    const client = this.#client;
    const transport = this.#transport;
    this.#client = null;
    this.#transport = null;
    const cleanup = Promise.allSettled([
      Promise.resolve().then(() =>
        client ? client.close() : transport?.close()
      ),
      ...(this.options.mcpServers ?? []).map((server) =>
        Promise.resolve().then(() => server.close())
      ),
    ]);
    // Start supervision immediately, independently of cooperative adapters.
    const cleanupComplete = boundedCleanup(cleanup);
    try {
      return await this.options.supervisor.stop(this.options.agentId);
    } finally {
      // A rejected stop must not detach even the bounded cleanup lifetime.
      await cleanupComplete;
    }
  }
}
