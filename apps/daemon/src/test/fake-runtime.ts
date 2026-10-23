import type { DeliveryMode } from "@missions/protocol/common";
import type { AgentModelSettings } from "@missions/protocol/missions";

import type { RuntimeHandle } from "../missions/mission-service";
import type { StopResult } from "../processes/process-supervisor";
import type {
  AgentEvent,
  AgentRuntimeOptions,
  RuntimeStartResult,
  SubmitOptions,
} from "../sdk/agent-runtime";
import { NativeQueueTracker } from "../sdk/native-queue";

/** Scripted stand-in for a Droid session: records submissions and lets tests drive events. */
export class FakeRuntime implements RuntimeHandle {
  readonly options: AgentRuntimeOptions;
  readonly queue: NativeQueueTracker;
  readonly submitted: {
    id: string;
    text: string;
    mode: DeliveryMode;
    options: SubmitOptions;
  }[] = [];
  readonly contexts: { id: string; text: string }[] = [];
  readonly interactionModes: ("auto" | "spec")[] = [];
  readonly availableModels: readonly unknown[] = [];
  sessionId: string | null = null;
  model: AgentModelSettings;
  readonly modelUpdates: AgentModelSettings[] = [];
  interrupts = 0;
  closed = false;
  /** PIDs that close() reports as still running. */
  survivors: number[] = [];
  /** When set and returning true, every submit rejects. */
  failSubmits: (() => boolean) | null = null;

  constructor(options: AgentRuntimeOptions) {
    this.options = options;
    this.model = {
      modelId: options.modelId,
      reasoningEffort: options.reasoningEffort,
    };
    this.queue = new NativeQueueTracker((entry) =>
      options.onEvent({ entry, type: "queue" })
    );
  }

  updateModel(choice: AgentModelSettings): Promise<AgentModelSettings> {
    if (this.closed) {
      return Promise.reject(new Error("Runtime is closed"));
    }
    this.model = choice;
    this.modelUpdates.push(choice);
    return Promise.resolve(choice);
  }

  start(resumeSessionId?: string): Promise<RuntimeStartResult> {
    this.sessionId = resumeSessionId ?? `session-${this.options.agentId}`;
    return Promise.resolve({
      cwd: this.options.cwd,
      messages: [],
      pendingIds: [],
      queuedIds: [],
      sessionId: this.sessionId,
      workingState: "idle",
    });
  }

  submit(
    id: string,
    text: string,
    mode: DeliveryMode,
    options: SubmitOptions = {}
  ) {
    if (this.failSubmits?.()) {
      return Promise.reject(new Error("spawn failed"));
    }
    this.submitted.push({ id, mode, options, text });
    this.queue.submitted(id, text, mode);
    this.queue.admitted(id);
    return Promise.resolve();
  }

  addContext(id: string, text: string) {
    this.contexts.push({ id, text });
    return Promise.resolve();
  }

  setInteractionMode(mode: "auto" | "spec") {
    this.interactionModes.push(mode);
    return Promise.resolve();
  }

  changeMode(id: string, mode: DeliveryMode) {
    this.queue.modeChanged(id, mode);
    return Promise.resolve();
  }

  remove(id: string) {
    if (this.queue.get(id)?.state === "sent") {
      return Promise.resolve("already_sent" as const);
    }
    this.queue.removing(id);
    this.queue.removeConfirmed(id);
    return Promise.resolve("removed" as const);
  }

  edit(id: string, replacementId: string, text: string) {
    return this.remove(id).then(async (outcome) => {
      if (outcome !== "removed") {
        return outcome === "already_sent"
          ? ("already_sent" as const)
          : ("delete_unconfirmed" as const);
      }
      await this.submit(
        replacementId,
        text,
        this.queue.get(id)?.mode ?? "queue"
      );
      return "replaced" as const;
    });
  }

  interrupt() {
    this.interrupts += 1;
    return Promise.resolve();
  }

  close(): Promise<StopResult> {
    this.closed = true;
    return Promise.resolve({
      stopped: this.survivors.length === 0,
      survivors: this.survivors,
    });
  }

  emit(event: AgentEvent) {
    this.options.onEvent(event);
  }

  /** Simulates the runner consuming a request and echoing it as a user message. */
  consume(id: string) {
    const entry = this.queue.get(id);
    this.queue.consumed(id);
    this.emit({
      message: {
        id: `msg-${id}`,
        requestId: id,
        role: "user",
        sender: null,
        text: entry?.text ?? "",
        thinking: "",
        toolResults: [],
        toolUses: [],
      },
      type: "message",
    });
  }

  async tool(name: string, input: Record<string, unknown>) {
    const found = this.options.mcpServers?.[0]?.tools.find(
      (candidate) => candidate.name === name
    );
    if (!found) {
      throw new Error(`No tool ${name}`);
    }
    return await found.handler(input);
  }
}
