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

import { errorMessage, sleep } from "../lib/async";
import type {
  ProcessSupervisor,
  StopResult,
} from "../processes/process-supervisor";
import { NativeQueueTracker } from "./native-queue";
import type { NativeQueueEntry } from "./native-queue";

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

export interface RuntimeMessage {
  id: string;
  role: "user" | "assistant" | "system";
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
  supervisor: ProcessSupervisor;
  onEvent: (event: AgentEvent) => void;
  onPermission: (ask: PermissionAsk) => Promise<boolean>;
  onAskUser: (ask: AskUserAsk) => Promise<AskUserAnswer>;
  /** Test seam: a fake transport exercises the adapter, not CLI scheduling. */
  createTransport?: () => DroidClientTransport;
  extraEnv?: Record<string, string>;
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
    requestId,
    role,
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
  error instanceof Error && error.name === "ProtocolError";

/**
 * Owns one agent's public SDK connection: one `ProcessTransport` and one
 * `DroidClient`, initialized in the shared mission directory with
 * `worktree: false`. Queue and Steer are native `addUserMessage` placements.
 */
export class AgentRuntime {
  readonly options: AgentRuntimeOptions;
  readonly queue: NativeQueueTracker;
  #client: DroidClient | null = null;
  #sessionId: string | null = null;
  #unsubscribers: (() => void)[] = [];
  #closing = false;

  constructor(options: AgentRuntimeOptions) {
    this.options = options;
    this.queue = new NativeQueueTracker((entry) =>
      options.onEvent({ entry, type: "queue" })
    );
  }

  get sessionId() {
    return this.#sessionId;
  }

  get connected() {
    return this.#client?.isConnected ?? false;
  }

  async #createTransport(): Promise<DroidClientTransport> {
    if (this.options.createTransport) {
      return this.options.createTransport();
    }
    const { supervisor, agentId, cwd } = this.options;
    const launcher = await supervisor.ensureLauncher();
    return new ProcessTransport({
      cwd,
      droidExecPath: launcher,
      env: {
        ...supervisor.launchEnv(agentId),
        FACTORY_UPSTREAM_CLIENT_TYPE: "sdk",
        ...this.options.extraEnv,
      },
      onSpawned: (child) => supervisor.register(agentId, child),
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
    const params = isRecord(raw.params) ? raw.params : raw;
    const n = isRecord(params.notification) ? params.notification : params;
    const type = str(n.type);
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
    if (message.role === "user") {
      const matched = requestId ?? this.#matchConsumedByText(message.text);
      if (matched) {
        message.requestId = matched;
        this.queue.consumed(matched);
      }
    }
    this.options.onEvent({ message, type: "message" });
  }

  /** Fallback when the runner omits the request ID: only an unambiguous match. */
  #matchConsumedByText(text: string) {
    const open = this.queue
      .list()
      .filter(
        (entry) =>
          (entry.state === "queued" ||
            entry.state === "submitting" ||
            entry.state === "removing") &&
          entry.text === text
      );
    return open.length === 1 && open[0] ? open[0].id : null;
  }

  async start(resumeSessionId?: string): Promise<RuntimeStartResult> {
    if (this.#client) {
      throw new Error("Runtime already started");
    }
    this.#closing = false;
    const transport = await this.#createTransport();
    const client = new DroidClient({ transport });
    this.#registerHandlers(client);
    this.#client = client;
    try {
      if (transport instanceof ProcessTransport) {
        await transport.connect();
      }
      // App-owned MCP servers are independent: start them together.
      const mcpServers = await Promise.all(
        (this.options.mcpServers ?? []).map(
          async (server) => server.config ?? (await server.start())
        )
      );
      return resumeSessionId
        ? await this.#load(client, resumeSessionId, mcpServers)
        : await this.#initialize(client, mcpServers);
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async #initialize(
    client: DroidClient,
    mcpServers: NonNullable<
      Parameters<DroidClient["initializeSession"]>[0]["mcpServers"]
    >
  ): Promise<RuntimeStartResult> {
    const { cwd, modelId, reasoningEffort, systemPrompt, disabledToolIds } =
      this.options;
    const response = await client.initializeSession({
      // SDK sessions always ask: the broker applies the user's autonomy, so
      // High cannot skip plan/publish gates through prompt-skipping.
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
    });
    const result: unknown = response.result;
    if (!isRecord(result) || typeof result.sessionId !== "string") {
      throw new Error("initializeSession returned no session ID");
    }
    this.#sessionId = result.sessionId;
    const worktree = isRecord(result.worktree) ? str(result.worktree.path) : "";
    return {
      cwd: worktree || cwd,
      messages: [],
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
    const result: unknown = response.result;
    if (!isRecord(result)) {
      throw new Error("loadSession returned no result");
    }
    this.#sessionId = sessionId;
    const session = isRecord(result.session) ? result.session : {};
    const rawMessages: unknown[] = Array.isArray(session.messages)
      ? session.messages
      : [];
    const messages = rawMessages
      .map((raw) => normalizeMessage(raw, null))
      .filter((message): message is RuntimeMessage => message !== null);
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

  /** Submits to the native queue; `id` is the stable SDK request ID. */
  async submit(id: string, text: string, mode: DeliveryMode) {
    const client = this.#requireClient();
    this.queue.submitted(id, text, mode);
    try {
      await client.addUserMessage(
        { queuePlacement: PLACEMENT[mode] as never, text },
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
    const mode = this.queue.get(id)?.mode ?? "steer";
    const removed = await this.remove(id);
    if (removed === "already_sent") {
      return "already_sent";
    }
    if (removed === "unconfirmed") {
      return "delete_unconfirmed";
    }
    await this.submit(replacementId, text, mode);
    return "replaced";
  }

  async interrupt() {
    await this.#requireClient().interruptSession();
  }

  /** Closes the client, app-owned MCP servers, and confirms the group is gone. */
  async close(): Promise<StopResult> {
    this.#closing = true;
    for (const unsubscribe of this.#unsubscribers.splice(0)) {
      unsubscribe();
    }
    const client = this.#client;
    this.#client = null;
    if (client) {
      try {
        await client.close();
      } catch {
        // The supervisor below confirms the process state either way.
      }
    }
    await Promise.allSettled(
      (this.options.mcpServers ?? []).map((server) => server.close())
    );
    return await this.options.supervisor.stop(this.options.agentId);
  }
}
