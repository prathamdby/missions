import type {
  DroidClientTransport,
  SdkMcpServer,
} from "@factory/droid-sdk/node";
import type {
  DeliveryMode,
  ReasoningEffort,
  Role,
} from "@missions/protocol/common";
import type { AgentModelSettings } from "@missions/protocol/missions";

import type {
  ProcessSupervisor,
  StopResult,
} from "../processes/process-supervisor";
import type { SdkAttachments } from "../sdk/attachments";
import type { ComposerRuntime } from "../sdk/composer-catalog";
import type { NativeQueueEntry, NativeQueueTracker } from "../sdk/native-queue";

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

export type PermissionVerdict =
  | { approved: true; via: "policy" | "grant" | "user" }
  | {
      approved: false;
      reason: string;
      attribution: "policy" | "lifecycle" | "runtime" | "user";
    };

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

export interface SubmitOptions extends SdkAttachments {
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
  | {
      type: "permission_denied";
      toolUseIds: string[];
      reason: string;
      attribution: string;
    }
  | {
      type: "error";
      message: string;
      errorType: string | null;
      exitCode?: number;
    }
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
  onPermission: (ask: PermissionAsk) => Promise<PermissionVerdict>;
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

/** The subset of `AgentRuntime` the service drives; tests substitute a scripted runtime. */
export interface RuntimeHandle extends ComposerRuntime {
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
    text: string,
    options?: SubmitOptions
  ) => Promise<EditOutcome>;
  interrupt: () => Promise<void>;
  close: () => Promise<StopResult>;
}

export type RuntimeFactory = (options: AgentRuntimeOptions) => RuntimeHandle;
