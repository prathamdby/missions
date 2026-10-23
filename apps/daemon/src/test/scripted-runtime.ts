import { writeFile } from "node:fs/promises";
import path from "node:path";

import type { DeliveryMode } from "@missions/protocol/common";

import { errorMessage, sleep } from "../lib/async";
import { isSystemRequest } from "../missions/messages";
import type { RuntimeHandle } from "../missions/mission-service";
import type { StopResult } from "../processes/process-supervisor";
import type {
  AgentEvent,
  AgentRuntimeOptions,
  RuntimeStartResult,
} from "../sdk/agent-runtime";
import { NativeQueueTracker } from "../sdk/native-queue";

const NOTES_FILE = "NOTES.md";

/** Thrown between steps to abandon the rest of a turn. */
const INTERRUPTED = new Error("interrupted");

const resultText = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  const content = (value as { content?: { text?: string }[] } | null)?.content;
  return Array.isArray(content)
    ? content.map((part) => part.text ?? "").join("\n")
    : JSON.stringify(value);
};

/**
 * A deterministic agent that walks the full mission lifecycle (explore, plan,
 * dispatch, write behind a permission, hand off, complete) without spawning
 * Droid. Used by browser tests and offline demos via MISSIONS_SCRIPTED_AGENTS=1.
 * Steer messages land between steps; Queue messages wait for the turn to end.
 */
export class ScriptedRuntime implements RuntimeHandle {
  readonly queue: NativeQueueTracker;
  sessionId: string | null = null;
  readonly #options: AgentRuntimeOptions;
  readonly #delayMs: number;
  readonly #inbox: string[] = [];
  /** Steered messages already delivered mid-turn, acted on once the turn ends. */
  readonly #steered: { id: string; text: string }[] = [];
  #busy = false;
  #closed = false;
  #interrupted = false;
  #turns = 0;
  #seq = 0;
  #planRevision = 0;

  constructor(options: AgentRuntimeOptions, delayMs = 250) {
    this.#options = options;
    this.#delayMs = delayMs;
    this.queue = new NativeQueueTracker((entry) =>
      options.onEvent({ entry, type: "queue" })
    );
  }

  start(resumeSessionId?: string): Promise<RuntimeStartResult> {
    this.sessionId = resumeSessionId ?? `scripted-${this.#options.agentId}`;
    if (resumeSessionId) {
      this.#turns = 1;
    }
    return Promise.resolve({
      cwd: this.#options.cwd,
      messages: [],
      pendingIds: [],
      queuedIds: [],
      sessionId: this.sessionId,
      workingState: "idle",
    });
  }

  submit(id: string, text: string, mode: DeliveryMode) {
    this.queue.submitted(id, text, mode);
    this.queue.admitted(id);
    this.#inbox.push(id);
    void this.#pump();
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
    this.#drop(id);
    return Promise.resolve("removed" as const);
  }

  async edit(id: string, replacementId: string, text: string) {
    const mode = this.queue.get(id)?.mode ?? "queue";
    const outcome = await this.remove(id);
    if (outcome !== "removed") {
      return "already_sent" as const;
    }
    await this.submit(replacementId, text, mode);
    return "replaced" as const;
  }

  interrupt() {
    if (this.#busy) {
      this.#interrupted = true;
    }
    return Promise.resolve();
  }

  close(): Promise<StopResult> {
    this.#closed = true;
    return Promise.resolve({ stopped: true, survivors: [] });
  }

  #drop(id: string) {
    const index = this.#inbox.indexOf(id);
    if (index !== -1) {
      this.#inbox.splice(index, 1);
    }
  }

  #emit(event: AgentEvent) {
    if (!this.#closed) {
      this.#options.onEvent(event);
    }
  }

  #id(prefix: string) {
    this.#seq += 1;
    return `${this.#options.agentId}-${prefix}-${this.#seq}`;
  }

  async #step() {
    await sleep(this.#delayMs);
    if (this.#closed || this.#interrupted) {
      throw INTERRUPTED;
    }
    const steer = this.#inbox.find(
      (id) => this.queue.get(id)?.mode === "steer"
    );
    if (steer) {
      this.#drop(steer);
      this.#steered.push({ id: steer, text: this.#deliver(steer) });
      this.#say("Got your message; I will act on it after this step.");
    }
  }

  #deliver(id: string) {
    const text = this.queue.get(id)?.text ?? "";
    this.queue.consumed(id);
    this.#emit({
      message: {
        id: this.#id("user"),
        requestId: id,
        role: "user",
        text,
        thinking: "",
        toolResults: [],
        toolUses: [],
      },
      type: "message",
    });
    return text;
  }

  #say(text: string, thinking = "") {
    this.#emit({
      message: {
        id: this.#id("reply"),
        requestId: null,
        role: "assistant",
        text,
        thinking,
        toolResults: [],
        toolUses: [],
      },
      type: "message",
    });
  }

  async #pump(): Promise<void> {
    if (this.#busy || this.#closed) {
      return;
    }
    const steered = this.#steered.shift();
    const next = steered?.id ?? this.#inbox.shift();
    if (!next) {
      return;
    }
    this.#busy = true;
    this.#interrupted = false;
    const text = steered?.text ?? this.#deliver(next);
    this.#emit({ state: "working", type: "working_state" });
    let reason = "end_turn";
    try {
      await this.#turn(next, text);
    } catch (error) {
      if (error !== INTERRUPTED) {
        this.#emit({
          errorType: "scripted",
          message: errorMessage(error),
          type: "error",
        });
      }
      reason = "interrupted";
    }
    this.#turns += 1;
    this.#busy = false;
    this.#emit({ reason, turnId: null, type: "turn_completed" });
    this.#emit({ state: "idle", type: "working_state" });
    await this.#pump();
  }

  async #roleTool(name: string, input: Record<string, unknown>) {
    const toolUseId = this.#id("tool");
    this.#emit({ input, name, toolUseId, type: "tool_call" });
    const found = this.#options.mcpServers?.[0]?.tools.find(
      (candidate) => candidate.name === name
    );
    let content = `Unknown tool ${name}`;
    let isError = true;
    if (found) {
      try {
        content = resultText(await found.handler(input));
        isError = false;
      } catch (error) {
        content = errorMessage(error);
      }
    }
    this.#emit({ content, isError, toolUseId, type: "tool_result" });
    await this.#step();
    return { content, isError };
  }

  async #read(file: string, content: string) {
    const toolUseId = this.#id("tool");
    this.#emit({
      input: { file_path: path.join(this.#options.cwd, file) },
      name: "Read",
      toolUseId,
      type: "tool_call",
    });
    this.#emit({ content, isError: false, toolUseId, type: "tool_result" });
    await this.#step();
  }

  async #create(file: string, content: string) {
    const toolUseId = this.#id("tool");
    const filePath = path.join(this.#options.cwd, file);
    const input = { content, file_path: filePath };
    this.#emit({ input, name: "Create", toolUseId, type: "tool_call" });
    const approved = await this.#options.onPermission({
      agentId: this.#options.agentId,
      toolUses: [
        {
          confirmationType: "create",
          details: { content, fileName: file, filePath, type: "create" },
          input,
          toolName: "Create",
          toolUseId,
        },
      ],
    });
    if (approved) {
      await writeFile(filePath, content);
    }
    this.#emit({
      content: approved ? `Created ${file}` : "The user denied this change",
      isError: !approved,
      toolUseId,
      type: "tool_result",
    });
    await this.#step();
    return approved;
  }

  async #turn(requestId: string, text: string) {
    await this.#step();
    if (this.#options.role === "worker") {
      await this.#workerTurn(text);
      return;
    }
    if (text.includes("approved plan revision")) {
      await this.#roleTool("update_todos", {
        todos: [
          { content: `Write ${NOTES_FILE}`, status: "in_progress" },
          { content: "Review the change", status: "pending" },
        ],
      });
      await this.#roleTool("dispatch_worker", {
        instructions: `Create ${NOTES_FILE} with a short summary of the mission goal.`,
        needsWrite: true,
        title: `Write ${NOTES_FILE}`,
      });
      this.#say("A Worker is writing the notes. I will review its handoff.");
      return;
    }
    if (text.includes("finished assignment")) {
      await this.#read(NOTES_FILE, "# Notes");
      await this.#roleTool("update_todos", {
        todos: [
          { content: `Write ${NOTES_FILE}`, status: "completed" },
          { content: "Review the change", status: "completed" },
        ],
      });
      await this.#roleTool("complete_mission", {
        checks: [{ command: `test -f ${NOTES_FILE}`, outcome: "passed" }],
        summary: `Added ${NOTES_FILE} and reviewed it.`,
      });
      this.#say(`Done. ${NOTES_FILE} is ready for review.`);
      return;
    }
    if (text.includes("requested changes")) {
      await this.#propose("Revised plan");
      return;
    }
    if (isSystemRequest(requestId) && this.#turns > 0) {
      this.#say("Re-checked the workspace; continuing from where we left off.");
      return;
    }
    if (this.#turns === 0) {
      this.#say(
        "I looked through the repository layout.",
        "Reading the README to understand the project."
      );
      await this.#read("README.md", "# Project");
      await this.#propose("Plan");
      return;
    }
    this.#say(`Noted: ${text.slice(0, 200)}`);
  }

  async #propose(title: string) {
    this.#planRevision += 1;
    await this.#roleTool("propose_plan", {
      markdown: `## ${title}\n\n1. Dispatch a Worker to write ${NOTES_FILE}.\n2. Review the result and finish.`,
      title: `${title} ${this.#planRevision}`,
    });
    this.#say("The plan is ready for your review.");
  }

  async #workerTurn(text: string) {
    if (!text.includes("Assignment")) {
      this.#say(`Understood: ${text.slice(0, 200)}`);
      return;
    }
    await this.#roleTool("update_todos", {
      todos: [{ content: `Write ${NOTES_FILE}`, status: "in_progress" }],
    });
    const created = await this.#create(
      NOTES_FILE,
      "# Notes\n\nWritten by the scripted Worker.\n"
    );
    await this.#roleTool("submit_handoff", {
      checks: created
        ? [{ command: `test -f ${NOTES_FILE}`, outcome: "passed" }]
        : [],
      filesChanged: created ? [NOTES_FILE] : [],
      followUps: created ? [] : ["The write was denied"],
      summary: created
        ? `Created ${NOTES_FILE}.`
        : `Could not create ${NOTES_FILE}: permission denied.`,
    });
  }
}

export const scriptedModels = () =>
  Promise.resolve([
    {
      defaultReasoningEffort: "low",
      displayName: "Scripted (offline)",
      id: "scripted",
      supportedReasoningEfforts: ["low", "medium", "high"],
    },
  ]);
