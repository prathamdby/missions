import { writeFile } from "node:fs/promises";
import path from "node:path";

import type { DeliveryMode } from "@missions/protocol/common";
import type { AgentModelSettings } from "@missions/protocol/missions";

import { errorMessage, sleep } from "../lib/async";
import { isSystemRequest } from "../missions/messages";
import type { RuntimeHandle } from "../missions/mission-service";
import type { StopResult } from "../processes/process-supervisor";
import type {
  AgentEvent,
  AgentRuntimeOptions,
  RuntimeStartResult,
  SubmitOptions,
} from "../sdk/agent-runtime";
import { NativeQueueTracker } from "../sdk/native-queue";
import {
  EXPLORE_TOOLS,
  INSTALL_RUN,
  QUESTIONS,
  RICH_PLAN,
  RICH_TODOS,
  START_FAILURE,
  TEST_RUN,
  WORKER_INSTALL,
  WORKER_RATE_LIMIT,
  WORKER_TODOS,
  scenarioOf,
} from "./scripted-scenarios";
import type { Scenario, ScriptedTool } from "./scripted-scenarios";

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
 * A deterministic agent that walks the full mission lifecycle (explore, an
 * optional Plan-mode proposal, dispatch, write behind a permission, hand off,
 * complete) without spawning Droid. Used by browser tests and offline demos
 * via MISSIONS_SCRIPTED_AGENTS=1.
 * Steer messages land between steps; Queue messages wait for the turn to end.
 */
export class ScriptedRuntime implements RuntimeHandle {
  readonly queue: NativeQueueTracker;
  sessionId: string | null = null;
  model: AgentModelSettings;
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
  #scenario: Scenario = "default";
  #mode: "auto" | "spec" = "auto";
  /** Model-only context, such as planning guidance; never starts a turn. */
  readonly #contexts: string[] = [];
  readonly availableModels: readonly unknown[] = [];

  constructor(options: AgentRuntimeOptions, delayMs = 250) {
    this.#options = options;
    this.model = {
      modelId: options.modelId,
      reasoningEffort: options.reasoningEffort,
    };
    this.#delayMs = delayMs;
    this.queue = new NativeQueueTracker((entry) =>
      options.onEvent({ entry, type: "queue" })
    );
  }

  updateModel(choice: AgentModelSettings): Promise<AgentModelSettings> {
    if (this.#closed) {
      return Promise.reject(new Error("Runtime is closed"));
    }
    this.model = choice;
    return Promise.resolve(choice);
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

  submit(
    id: string,
    text: string,
    mode: DeliveryMode,
    _options: SubmitOptions = {}
  ) {
    if (
      this.#options.role === "orchestrator" &&
      this.#turns === 0 &&
      START_FAILURE.test(text)
    ) {
      return Promise.reject(
        new Error("droid exited with code 1: could not load the model")
      );
    }
    this.queue.submitted(id, text, mode);
    this.queue.admitted(id);
    this.#inbox.push(id);
    void this.#pump();
    return Promise.resolve();
  }

  addContext(_id: string, text: string) {
    this.#contexts.push(text);
    return Promise.resolve();
  }

  setInteractionMode(mode: "auto" | "spec") {
    this.#mode = mode;
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
        sender: null,
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
        sender: null,
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

  async #tool({ content, input, isError = false, name }: ScriptedTool) {
    const toolUseId = this.#id("tool");
    this.#emit({ input, name, toolUseId, type: "tool_call" });
    this.#emit({ content, isError, toolUseId, type: "tool_result" });
    await this.#step();
  }

  /** Runs tools one after another, as a real agent's turn does. */
  async #tools(list: readonly ScriptedTool[]): Promise<void> {
    const [first, ...rest] = list;
    if (!first) {
      return;
    }
    await this.#tool(first);
    await this.#tools(rest);
  }

  async #rateLimited(attempt: number) {
    this.#emit({
      attempt,
      reason: "429 Too Many Requests: rate limit reached for requests",
      type: "retry",
    });
    await this.#step();
  }

  async #read(file: string, content: string) {
    await this.#tool({
      content,
      input: { file_path: path.join(this.#options.cwd, file) },
      name: "Read",
    });
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
    if (text.includes("finished assignment")) {
      await this.#read(NOTES_FILE, "# Notes");
      const finished =
        this.#scenario === "default"
          ? [`Write ${NOTES_FILE}`, "Review the change"]
          : RICH_TODOS;
      await this.#roleTool("update_todos", {
        todos: finished.map((content) => ({ content, status: "completed" })),
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
    if (text.includes("Plan mode is now active")) {
      await this.#propose("Plan");
      return;
    }
    if (isSystemRequest(requestId) && this.#turns > 0) {
      // After a restart the scenario marker is gone; the interrupted
      // assignment titles in the resume message identify the work.
      if (text.includes("Add Clock interface")) {
        this.#say("Re-dispatching the interrupted assignment.");
        await this.#startRichWork();
        return;
      }
      if (text.includes(NOTES_FILE)) {
        await this.#startDefaultWork();
        return;
      }
      this.#say("Re-checked the workspace; continuing from where we left off.");
      return;
    }
    if (this.#turns === 0) {
      this.#scenario = scenarioOf(text);
    }
    if (this.#turns === 0 && this.#scenario !== "default") {
      await this.#explore();
      return;
    }
    if (this.#turns === 0) {
      this.#say(
        "I looked through the repository layout.",
        "Reading the README to understand the project."
      );
      await this.#read("README.md", "# Project");
      await this.#planOrWork();
      return;
    }
    this.#say(`Noted: ${text.slice(0, 200)}`);
  }

  async #startDefaultWork() {
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
  }

  /**
   * Plan mode: presents the plan through native ExitSpecMode, as the CLI
   * does, and continues the same turn once the user approves it.
   */
  async #propose(title: string) {
    this.#planRevision += 1;
    const rich = this.#scenario !== "default";
    if (rich) {
      await this.#roleTool("update_todos", {
        todos: RICH_TODOS.map((content) => ({ content, status: "pending" })),
      });
      this.#say("Here’s the plan. Nothing runs until you approve it.");
    }
    const plan = rich
      ? RICH_PLAN
      : `## ${title}\n\n1. Dispatch a Worker to write ${NOTES_FILE}.\n2. Review the result and finish.`;
    const planTitle = rich
      ? "Make the webhook retry test deterministic"
      : `${title} ${this.#planRevision}`;
    const toolUseId = this.#id("tool");
    const input = { plan, title: planTitle };
    this.#emit({ input, name: "ExitSpecMode", toolUseId, type: "tool_call" });
    if (!rich) {
      this.#say("The plan is ready for your review.");
    }
    const approved = await this.#options.onPermission({
      agentId: this.#options.agentId,
      toolUses: [
        {
          confirmationType: "exit_spec_mode",
          details: { plan, title: planTitle, type: "exit_spec_mode" },
          input,
          toolName: "ExitSpecMode",
          toolUseId,
        },
      ],
    });
    this.#emit({
      content: approved ? "Plan approved" : "The user wants changes",
      isError: !approved,
      toolUseId,
      type: "tool_result",
    });
    if (!approved) {
      return;
    }
    this.#mode = "auto";
    await this.#step();
    await (rich ? this.#startRichWork() : this.#startDefaultWork());
  }

  /** Work mode starts directly; Plan mode presents a plan first. */
  async #planOrWork() {
    if (this.#mode === "spec") {
      await this.#propose("Plan");
      return;
    }
    await (this.#scenario === "default"
      ? this.#startDefaultWork()
      : this.#startRichWork());
  }

  /** Paper QAU to RHI: explore, run the failing test, ask two questions, plan. */
  async #explore() {
    this.#say("I’ll read the test and the retry code before planning.");
    await this.#tools(EXPLORE_TOOLS);
    await this.#tool(TEST_RUN);
    this.#say(
      "Found it. Backoff uses real timers and Date.now(), so on a slow CI runner the retry sometimes fires after the assertion. Two decisions before I plan."
    );
    await this.#options.onAskUser({
      agentId: this.#options.agentId,
      questions: QUESTIONS,
      toolCallId: this.#id("ask"),
    });
    await this.#step();
    await this.#planOrWork();
  }

  async #startRichWork() {
    await this.#roleTool("update_todos", {
      todos: RICH_TODOS.map((content, index) => ({
        content,
        status: index === 0 ? "in_progress" : "pending",
      })),
    });
    const extra = {
      blocked: ` ${WORKER_INSTALL}`,
      default: "",
      explore: "",
      rate_limit: ` ${WORKER_RATE_LIMIT}`,
    }[this.#scenario];
    this.#say("Starting with the clock. A worker is on it.");
    await this.#roleTool("dispatch_worker", {
      instructions: `Add src/time/clock.ts with a system clock and a fake clock, then inject it into retry-queue.ts.${extra}`,
      needsWrite: true,
      title: "Add Clock interface",
    });
  }

  /** Worker side of the rich scenarios: rate limits or a failing install first. */
  async #richWorkerPrelude(text: string) {
    await this.#roleTool("update_todos", {
      todos: WORKER_TODOS.map((content, index) => ({
        content,
        status: index === 0 ? "in_progress" : "pending",
      })),
    });
    if (text.includes(WORKER_RATE_LIMIT)) {
      await this.#rateLimited(1);
      await this.#rateLimited(2);
    }
    if (text.includes(WORKER_INSTALL)) {
      await this.#tool(INSTALL_RUN);
      this.#emit({
        errorType: "environment",
        message: `$ pnpm install\n${INSTALL_RUN.content}`,
        type: "error",
      });
      return false;
    }
    return true;
  }

  async #workerTurn(text: string) {
    if (!text.includes("Assignment")) {
      this.#say(`Understood: ${text.slice(0, 200)}`);
      return;
    }
    const rich = text.includes("Add src/time/clock.ts");
    if (rich && !(await this.#richWorkerPrelude(text))) {
      return;
    }
    if (!rich) {
      await this.#tool({
        content: "Todos saved",
        input: { todos: `1. [in_progress] Write ${NOTES_FILE}` },
        name: "TodoWrite",
      });
    }
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
