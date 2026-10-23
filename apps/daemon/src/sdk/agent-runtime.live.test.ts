import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { pollUntil, sleep } from "../lib/async";
import { PermissionBroker } from "../permissions/permission-broker";
import type { AgentContext } from "../permissions/permission-broker";
import { ProcessSupervisor } from "../processes/process-supervisor";
import { WriteLeaseRegistry } from "../workspaces/write-lease";
import { AgentRuntime } from "./agent-runtime";
import type { AgentEvent, AgentRuntimeOptions } from "./agent-runtime";
import { createRoleToolServer, ROLE_TOOL_SERVER } from "./role-tools";
import type { RoleToolHandlers } from "./role-tools";

/**
 * Real-runner evidence for native Queue/Steer, interrupt, load, MCP, permission
 * gates, and process stop. Opt-in: `pnpm test:live` (MISSIONS_LIVE=1). Uses a
 * cheap model and tiny prompts; never runs in the default gate.
 */

const MODEL = process.env.MISSIONS_LIVE_MODEL ?? "glm-5.3-flash";
const DROID =
  process.env.MISSIONS_DROID_PATH ??
  path.join(os.homedir(), ".local/bin/droid");
const STEP_MS = 120_000;

interface Recorder {
  events: AgentEvent[];
  until: (
    pred: (event: AgentEvent) => boolean,
    ms?: number
  ) => Promise<AgentEvent>;
  push: (event: AgentEvent) => void;
}

const recorder = (): Recorder => {
  const events: AgentEvent[] = [];
  let waiters: {
    pred: (e: AgentEvent) => boolean;
    resolve: (e: AgentEvent) => void;
  }[] = [];
  return {
    events,
    push: (event) => {
      events.push(event);
      if (
        process.env.MISSIONS_LIVE_DEBUG === "1" &&
        event.type !== "text_delta" &&
        event.type !== "thinking_delta"
      ) {
        process.stdout.write(`${JSON.stringify(event).slice(0, 400)}\n`);
      }
      const matched = waiters.filter((waiter) => waiter.pred(event));
      waiters = waiters.filter((waiter) => !matched.includes(waiter));
      for (const waiter of matched) {
        waiter.resolve(event);
      }
    },
    until: (pred, ms = STEP_MS) => {
      const { promise, resolve, reject } = Promise.withResolvers<AgentEvent>();
      waiters.push({ pred, resolve });
      setTimeout(
        () => reject(new Error("Timed out waiting for runner event")),
        ms
      );
      return promise;
    },
  };
};

const executing = (event: AgentEvent) =>
  event.type === "working_state" && event.state === "executing_tool";
const turnDone = (event: AgentEvent) => event.type === "turn_completed";
const userMessage = (id: string) => (event: AgentEvent) =>
  event.type === "message" &&
  event.message.role === "user" &&
  event.message.requestId === id;
const indexOf = (events: AgentEvent[], pred: (event: AgentEvent) => boolean) =>
  events.findIndex(pred);

const workspace = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "missions-live-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
};

const runtimes: AgentRuntime[] = [];
const askNobody = () => Promise.resolve({ answers: [], cancelled: true });
const allowAll = () => Promise.resolve(true);

const supervisorFor = (dir: string) =>
  new ProcessSupervisor({
    binDir: path.join(dir, ".git", "missions-bin"),
    droidPath: DROID,
  });

const sleepersFor = (marker: string) => {
  const out = execFileSync("ps", ["-eo", "pid=,sid=,args="]).toString();
  return out
    .split("\n")
    .map((line) => line.trim().split(/\s+/u))
    .filter((cols) => cols.slice(2).join(" ") === `sleep ${marker}`)
    .map((cols) => ({ pid: Number(cols[0]), sid: Number(cols[1]) }));
};

const stopped = { stopped: true, survivors: [] };

const makeRuntime = (
  dir: string,
  supervisor: ProcessSupervisor,
  rec: Recorder,
  overrides: Partial<AgentRuntimeOptions> = {}
) => {
  const runtime = new AgentRuntime({
    agentId: overrides.agentId ?? `agent-${runtimes.length}`,
    cwd: dir,
    modelId: MODEL,
    onAskUser: askNobody,
    onEvent: rec.push,
    onPermission: allowAll,
    reasoningEffort: null,
    role: "worker",
    supervisor,
    ...overrides,
  });
  runtimes.push(runtime);
  return runtime;
};

describe.runIf(process.env.MISSIONS_LIVE === "1")("live Droid runner", () => {
  afterAll(async () => {
    await Promise.allSettled(runtimes.map((runtime) => runtime.close()));
  });

  it("gives each agent its own client and process in one shared cwd without an SDK worktree", async () => {
    const dir = await workspace();
    const supervisor = supervisorFor(dir);
    const a = makeRuntime(dir, supervisor, recorder(), { agentId: "shared-a" });
    const b = makeRuntime(dir, supervisor, recorder(), { agentId: "shared-b" });
    const [startA, startB] = await Promise.all([a.start(), b.start()]);
    const pidA = supervisor.record("shared-a")?.pid ?? -1;
    const pidB = supervisor.record("shared-b")?.pid ?? -1;
    const worktrees = execFileSync("git", ["worktree", "list"], { cwd: dir })
      .toString()
      .trim()
      .split("\n");
    expect({
      cwds: [startA.cwd, startB.cwd],
      distinctPids: pidA > 0 && pidB > 0 && pidA !== pidB,
      distinctSessions: startA.sessionId !== startB.sessionId,
      worktrees: worktrees.length,
    }).toStrictEqual({
      cwds: [dir, dir],
      distinctPids: true,
      distinctSessions: true,
      worktrees: 1,
    });
    await expect(Promise.all([a.close(), b.close()])).resolves.toStrictEqual([
      stopped,
      stopped,
    ]);
  }, 180_000);

  it("delivers Steer after the current tool call and Queue after the loop", async () => {
    const dir = await workspace();
    const rec = recorder();
    const runtime = makeRuntime(dir, supervisorFor(dir), rec);
    await runtime.start();
    await runtime.submit(
      "steer-base",
      "Use the Execute tool to run exactly: sleep 6; echo tool-done . Then reply ALPHA.",
      "steer"
    );
    await rec.until(executing);
    await runtime.submit(
      "steer-1",
      "Also include the word STEERED in your reply.",
      "steer"
    );
    await runtime.submit(
      "queue-1",
      "Reply with only the word QUEUED.",
      "queue"
    );
    await rec.until(userMessage("queue-1"));
    await rec.until(turnDone);
    const { events } = rec;
    const toolResult = indexOf(events, (e) => e.type === "tool_result");
    const steer = indexOf(events, userMessage("steer-1"));
    const queue = indexOf(events, userMessage("queue-1"));
    const replyBeforeQueue = events
      .slice(steer, queue)
      .some(
        (e) =>
          e.type === "message" &&
          e.message.role === "assistant" &&
          e.message.text !== ""
      );
    expect({
      queueAfterSteer: queue > steer,
      replyBeforeQueue,
      states: [
        runtime.queue.get("steer-1")?.state,
        runtime.queue.get("queue-1")?.state,
      ],
      steerAfterTool: toolResult > -1 && steer > toolResult,
    }).toStrictEqual({
      queueAfterSteer: true,
      replyBeforeQueue: true,
      states: ["sent", "sent"],
      steerAfterTool: true,
    });
    await runtime.close();
  }, 240_000);

  it("batches four sender-attributed reports and a user steer at one tool boundary; Queue waits for the loop", async () => {
    const dir = await workspace();
    const supervisor = supervisorFor(dir);
    const rec = recorder();
    const peer = makeRuntime(dir, supervisor, recorder(), {
      agentId: "batch-peer",
    });
    const runtime = makeRuntime(dir, supervisor, rec, {
      agentId: "batch-main",
      role: "orchestrator",
    });
    const [{ sessionId: peerSession }] = await Promise.all([
      peer.start(),
      runtime.start(),
    ]);
    await runtime.submit(
      "batch-base",
      "Use the Execute tool to run exactly: sleep 8; echo tool-done . After it finishes, reply with one short sentence listing every message you received while it ran.",
      "steer"
    );
    await rec.until(executing);
    const reports = ["A", "B", "C", "D"];
    await Promise.all(
      reports.map((name) =>
        runtime.submit(
          `report-${name}`,
          `Report ${name}: checked module ${name}, no problems.`,
          "steer",
          {
            sender: {
              kind: "agent",
              sessionId: peerSession,
              title: `Worker ${name}`,
            },
          }
        )
      )
    );
    await runtime.submit("user-steer", "User: also mention BLUE.", "steer");
    await runtime.submit(
      "deferred",
      "Reply with only the word LATER.",
      "queue"
    );
    await rec.until(userMessage("deferred"));
    await rec.until(turnDone);
    const { events } = rec;
    const toolResult = indexOf(events, (e) => e.type === "tool_result");
    const steerIds = [...reports.map((name) => `report-${name}`), "user-steer"];
    const delivered = steerIds.map((id) => indexOf(events, userMessage(id)));
    const firstReply = events.findIndex(
      (e, index) =>
        index > toolResult &&
        e.type === "message" &&
        e.message.role === "assistant" &&
        e.message.text !== ""
    );
    const deferred = indexOf(events, userMessage("deferred"));
    const senders = steerIds.map((id) => {
      const found = events.find(userMessage(id));
      return found?.type === "message"
        ? (found.message.sender?.kind ?? null)
        : "missing";
    });
    expect({
      allAfterTool: delivered.every((index) => index > toolResult),
      batchedBeforeReply: delivered.every(
        (index) => index > -1 && index < firstReply
      ),
      deferredAfterReply: deferred > firstReply,
      senders,
      states: [...steerIds, "deferred"].map(
        (id) => runtime.queue.get(id)?.state
      ),
    }).toStrictEqual({
      allAfterTool: true,
      batchedBeforeReply: true,
      deferredAfterReply: true,
      senders: ["agent", "agent", "agent", "agent", null],
      states: ["sent", "sent", "sent", "sent", "sent", "sent"],
    });
    await Promise.all([runtime.close(), peer.close()]);
  }, 300_000);

  it("blocks on MCP load, adds hidden context without a turn, and asks ExitSpecMode in Spec mode", async () => {
    const dir = await workspace();
    const rec = recorder();
    const exits: string[] = [];
    const runtime = makeRuntime(dir, supervisorFor(dir), rec, {
      agentId: "spec-main",
      blockOnMcpLoad: true,
      mcpServers: [
        createRoleToolServer(
          "orchestrator",
          "spec-main",
          {} as unknown as RoleToolHandlers
        ),
      ],
      onPermission: (ask) => {
        for (const use of ask.toolUses) {
          if (use.toolName === "ExitSpecMode") {
            exits.push(String(use.details.plan ?? ""));
          }
        }
        return Promise.resolve(true);
      },
      role: "orchestrator",
    });
    await runtime.start();
    await runtime.addContext("ctx-1", "The project codename is PELICAN.");
    await sleep(3000);
    const turnsAfterContext = rec.events.filter(turnDone).length;
    await runtime.setInteractionMode("spec");
    await runtime.submit(
      "spec-1",
      "Plan creating codename.txt that contains the project codename. Keep the plan to one line, present it for approval, then once approved create the file and reply DONE.",
      "steer"
    );
    const file = path.join(dir, "codename.txt");
    const written = await pollUntil(
      async () => (existsSync(file) ? await readFile(file, "utf-8") : ""),
      (text) => text.includes("PELICAN"),
      Date.now() + 240_000,
      1000
    );
    expect({
      exitRequested: exits.length > 0,
      file: written.includes("PELICAN"),
      turnsAfterContext,
    }).toStrictEqual({ exitRequested: true, file: true, turnsAfterContext: 0 });
    await runtime.close();
  }, 300_000);

  it("changes placement and deletes queued messages natively", async () => {
    const dir = await workspace();
    const rec = recorder();
    const runtime = makeRuntime(dir, supervisorFor(dir), rec);
    await runtime.start();
    await runtime.submit(
      "base",
      "Use the Execute tool to run exactly: sleep 6; echo b-done . Then reply BRAVO.",
      "steer"
    );
    await rec.until(executing);
    await runtime.submit(
      "to-delete",
      "Reply with only the word SHOULD-NOT-APPEAR.",
      "queue"
    );
    await expect(runtime.remove("to-delete")).resolves.toBe("removed");
    await runtime.submit(
      "to-steer",
      "Reply with only the word CHANGED.",
      "queue"
    );
    await runtime.changeMode("to-steer", "steer");
    await rec.until(userMessage("to-steer"));
    await rec.until(turnDone);
    const steerAt = indexOf(rec.events, userMessage("to-steer"));
    const resultAt = indexOf(rec.events, (e) => e.type === "tool_result");
    expect(steerAt).toBeGreaterThan(resultAt);
    expect(indexOf(rec.events, userMessage("to-delete"))).toBe(-1);
    expect(runtime.queue.get("to-delete")?.state).toBe("removed");
    // Deleting after consumption is reported honestly, never as removed.
    await expect(runtime.remove("to-steer")).resolves.toBe("already_sent");
    await runtime.close();
  }, 240_000);

  it("edits by cancel-and-requeue with a new request ID", async () => {
    const dir = await workspace();
    const rec = recorder();
    const runtime = makeRuntime(dir, supervisorFor(dir), rec);
    await runtime.start();
    await runtime.submit(
      "base",
      "Use the Execute tool to run exactly: sleep 6; echo e-done . Then reply ECHO.",
      "steer"
    );
    await rec.until(executing);
    await runtime.submit("draft", "Reply with only the word OLD.", "queue");
    await expect(
      runtime.edit("draft", "draft-2", "Reply with only the word NEW.")
    ).resolves.toBe("replaced");
    await rec.until(userMessage("draft-2"));
    await rec.until(turnDone);
    expect(indexOf(rec.events, userMessage("draft"))).toBe(-1);
    expect(runtime.queue.get("draft")?.state).toBe("removed");
    expect(runtime.queue.get("draft-2")).toMatchObject({
      mode: "queue",
      state: "sent",
    });
    await runtime.close();
  }, 240_000);

  it("interrupt discards steering but leaves end-of-loop entries until deleted; load reconciles", async () => {
    const dir = await workspace();
    const rec = recorder();
    const supervisor = supervisorFor(dir);
    const runtime = makeRuntime(dir, supervisor, rec, { agentId: "interrupt" });
    const started = await runtime.start();
    await runtime.submit(
      "long",
      "Use the Execute tool to run exactly: sleep 30; echo d-done . Then reply DELTA.",
      "steer"
    );
    await rec.until(executing);
    await runtime.submit(
      "q-left",
      "Reply with only the word LEFTOVER.",
      "queue"
    );
    await runtime.submit(
      "q-gone",
      "Reply with only the word REMOVED.",
      "queue"
    );
    await runtime.submit("s-int", "Steering during interrupt.", "steer");
    await runtime.interrupt();
    const completed = await rec.until(turnDone);
    expect(completed).toMatchObject({ reason: "cancelled" });
    await sleep(2000);
    // Interrupt alone does not clear end-of-loop entries.
    expect([
      runtime.queue.get("s-int")?.state,
      runtime.queue.get("q-gone")?.state,
    ]).toStrictEqual(["discarded", "queued"]);
    await expect(runtime.remove("q-gone")).resolves.toBe("removed");
    const mirrored = runtime.queue.list();
    await runtime.close();

    const loadedRec = recorder();
    const reloaded = makeRuntime(dir, supervisor, loadedRec, {
      agentId: "interrupt-2",
    });
    reloaded.queue.hydrate(mirrored);
    const loaded = await reloaded.start(started.sessionId);
    reloaded.queue.reconcile({
      consumedIds: new Set(),
      pendingIds: loaded.pendingIds,
      queuedIds: loaded.queuedIds,
    });
    // The new runner has no queue; the leftover is never replayed blindly.
    expect({
      cwd: loaded.cwd,
      hasHistory: loaded.messages.some(
        (m) => m.role === "user" && m.text.includes("sleep 30")
      ),
      states: [
        reloaded.queue.get("q-left")?.state,
        reloaded.queue.get("q-gone")?.state,
      ],
    }).toStrictEqual({
      cwd: dir,
      hasHistory: true,
      states: ["unknown", "removed"],
    });
    await reloaded.close();
  }, 240_000);

  // Retry: the cheap live model sometimes skips the MCP tool call.
  it(
    "serves app-owned MCP role tools and enforces the plan gate on writes",
    { retry: 1, timeout: 400_000 },
    async () => {
      const dir = await workspace();
      const rec = recorder();
      const todos: unknown[] = [];
      const handlers = {
        updateTodos: (_agentId: string, input: { todos: unknown[] }) => {
          todos.push(...input.todos);
          return Promise.resolve("Todos saved");
        },
      } as unknown as RoleToolHandlers;
      let planMode = true;
      const context = (): AgentContext => ({
        autonomy: "high",
        epoch: 0,
        fenced: false,
        missionId: "m",
        planMode,
        projectId: "p",
        role: "worker",
        workspacePath: dir,
      });
      const leases = new WriteLeaseRegistry();
      const broker = new PermissionBroker({
        acquireWriteLease: (agentId, signal) =>
          leases.acquire(dir, agentId, signal),
        context,
        roleToolServer: ROLE_TOOL_SERVER,
        store: {
          addGrant: () => {},
          listGrants: () => [],
          saveRequest: () => {},
        },
      });
      const runtime = makeRuntime(dir, supervisorFor(dir), rec, {
        agentId: "gate",
        mcpServers: [createRoleToolServer("worker", "gate", handlers)],
        onPermission: async (ask) => {
          const result = await broker.ask(ask.agentId, ask.toolUses);
          return result.approved;
        },
      });
      await runtime.start();
      await runtime.submit(
        "todo",
        "First call the missions update_todos tool with one pending todo 'probe'. Then use the Create tool to create note.txt containing hi. Then reply DONE.",
        "steer"
      );
      await rec.until(turnDone, 180_000);
      expect({
        noteWritten: existsSync(path.join(dir, "note.txt")),
        todos: todos.length,
      }).toStrictEqual({ noteWritten: false, todos: 1 });

      planMode = false;
      await runtime.submit(
        "write",
        "The plan is approved now. Use the Create tool to create note.txt containing hi, then reply DONE.",
        "steer"
      );
      await rec.until(turnDone, 180_000);
      await expect(
        readFile(path.join(dir, "note.txt"), "utf-8")
      ).resolves.toContain("hi");
      expect(leases.holder(dir)).toBe("gate");
      await runtime.close();
    }
  );

  it("stops fire-and-forget tool processes with the agent's session", async () => {
    const dir = await workspace();
    const rec = recorder();
    const supervisor = supervisorFor(dir);
    const runtime = makeRuntime(dir, supervisor, rec, { agentId: "bg" });
    await runtime.start();
    await runtime.submit(
      "bg",
      "Use the Execute tool with fireAndForget set to true to run exactly: sleep 301 . Then reply OK.",
      "steer"
    );
    await rec.until(turnDone, 180_000);
    const leader = supervisor.record("bg");
    const sleepers = sleepersFor("301");
    expect(sleepers.length).toBeGreaterThan(0);
    const members = new Set(
      await supervisor.members(leader?.pid ?? -1, leader?.tag)
    );
    expect(sleepers.every((s) => members.has(s.pid))).toBeTruthy();
    await expect(runtime.close()).resolves.toStrictEqual(stopped);
    expect(sleepersFor("301")).toHaveLength(0);
  }, 240_000);

  it("stops a foreground tool command when the agent is closed mid-call", async () => {
    const dir = await workspace();
    const rec = recorder();
    const runtime = makeRuntime(dir, supervisorFor(dir), rec, {
      agentId: "fg",
    });
    await runtime.start();
    await runtime.submit(
      "fg",
      "This is a process-supervision test; the command is intentionally slow. Use the Execute tool with timeout 120 to run exactly: sleep 45; echo late . Then reply OK.",
      "steer"
    );
    await rec.until(executing);
    const running = await pollUntil(
      () => Promise.resolve(sleepersFor("45")),
      (found) => found.length > 0,
      Date.now() + 10_000,
      200
    );
    expect(running.length).toBeGreaterThan(0);
    await expect(runtime.close()).resolves.toStrictEqual(stopped);
    expect(sleepersFor("45")).toHaveLength(0);
  }, 240_000);
});
