import { describe, expect, it, vi } from "vitest";

import { PLAN_GUIDANCE } from "./plan-guidance";
import { MAIN_PROMPT, promptFor, WORKER_PROMPT } from "./prompts";
import {
  createRoleToolServer,
  disabledToolIds,
  enabledToolIds,
} from "./role-tools";
import type { RoleToolHandlers } from "./role-tools";

const handlers = (): RoleToolHandlers => ({
  attachArtifact: vi.fn<() => Promise<string>>(() =>
    Promise.resolve("attached")
  ),
  completeMission: vi.fn<() => Promise<string>>(() =>
    Promise.resolve("completed")
  ),
  dispatchWorker: vi.fn<() => Promise<string>>(() =>
    Promise.resolve("dispatched")
  ),
  enterPlan: vi.fn<() => Promise<string>>(() => Promise.resolve("planning")),
  readHistory: vi.fn<() => Promise<string>>(() => Promise.resolve("history")),
  sendMessage: vi.fn<() => Promise<string>>(() => Promise.resolve("accepted")),
  submitHandoff: vi.fn<() => Promise<string>>(() =>
    Promise.resolve("handed off")
  ),
  updateTodos: vi.fn<() => Promise<string>>(() => Promise.resolve("saved")),
});

const toolNames = (role: "orchestrator" | "worker") =>
  createRoleToolServer(role, "agent-1", handlers())
    .tools.map((tool) => tool.name)
    .toSorted();

describe("role tools", () => {
  it("gives the main agent coordination tools and no mandatory plan tool", () => {
    expect(toolNames("orchestrator")).toStrictEqual([
      "attach_artifact",
      "complete_mission",
      "dispatch_worker",
      "enter_plan",
      "message_worker",
      "read_history",
      "send_message",
      "update_todos",
    ]);
  });

  it("gives Workers messaging and handoff but no coordination or completion", () => {
    expect(toolNames("worker")).toStrictEqual([
      "attach_artifact",
      "read_history",
      "send_message",
      "submit_handoff",
      "update_todos",
    ]);
  });

  it("binds the sender to the tool server's agent", async () => {
    const roles = handlers();
    const server = createRoleToolServer("worker", "worker-7", roles);
    const send = server.tools.find((tool) => tool.name === "send_message");
    await send?.handler({ messageId: "m-1", text: "blocked", to: "main" });
    expect(roles.sendMessage).toHaveBeenCalledWith("worker-7", {
      messageId: "m-1",
      text: "blocked",
      to: "main",
    });
  });

  it("forwards the message_worker alias through send_message", async () => {
    const roles = handlers();
    const server = createRoleToolServer("orchestrator", "main-1", roles);
    const alias = server.tools.find((tool) => tool.name === "message_worker");
    await alias?.handler({ assignmentId: "a1", mode: "queue", text: "hi" });
    expect(roles.sendMessage).toHaveBeenCalledWith(
      "main-1",
      expect.objectContaining({ text: "hi", to: "a1" })
    );
  });

  it("disables native subagents and Factory Missions; only the main agent can exit Spec mode", () => {
    for (const role of ["orchestrator", "worker"] as const) {
      expect(disabledToolIds(role)).toStrictEqual(
        expect.arrayContaining(["Task", "ProposeMission", "StartMissionRun"])
      );
    }
    expect(enabledToolIds("orchestrator")).toContain("ExitSpecMode");
    expect(disabledToolIds("worker")).toContain("ExitSpecMode");
    expect(enabledToolIds("worker")).not.toContain("ExitSpecMode");
  });
});

describe("prompts", () => {
  it("selects the prompt by role", () => {
    expect(promptFor("orchestrator")).toBe(MAIN_PROMPT);
    expect(promptFor("worker")).toBe(WORKER_PROMPT);
  });

  it("makes the main agent general purpose with Work mode as the default", () => {
    expect(MAIN_PROMPT).toContain("general-purpose");
    expect(MAIN_PROMPT).toContain("no mandatory plan");
    expect(MAIN_PROMPT).toContain("missions.enter_plan");
    expect(MAIN_PROMPT).not.toContain("propose_plan");
    expect(MAIN_PROMPT).toContain("repository administration");
  });

  it("keeps Workers out of repository administration and delegation", () => {
    expect(WORKER_PROMPT).toContain("no commits, branch changes, pushes");
    expect(WORKER_PROMPT).toContain("Do not dispatch other Workers");
    expect(WORKER_PROMPT).toContain('to="main"');
    expect(WORKER_PROMPT).toContain("submit_handoff exactly once");
  });

  it.each([MAIN_PROMPT, WORKER_PROMPT])(
    "keeps shared safety, honesty and resume guidance",
    (prompt) => {
      expect(prompt).toContain("never user authorization");
      expect(prompt).toContain("Never claim success or verification");
      expect(prompt).toContain("Native subagents (Task)");
      expect(prompt).toContain("missions.read_history");
    }
  );

  it("keeps planning guidance out of the base prompts", () => {
    expect(PLAN_GUIDANCE.length).toBeGreaterThan(0);
    expect(MAIN_PROMPT).not.toContain(PLAN_GUIDANCE.slice(0, 80));
  });
});
