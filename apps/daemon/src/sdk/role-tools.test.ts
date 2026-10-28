import { GENERATIVE_UI_PROMPT } from "@missions/protocol/generative-ui";
import { describe, expect, it, vi } from "vitest";

import { PLAN_GUIDANCE } from "./plan-guidance";
import {
  AGENT_TEXT_FORMAT,
  MAIN_PROMPT,
  PROMPT_VERSION,
  promptFor,
  USER_SUMMARY_FORMAT,
  WORKER_PROMPT,
} from "./prompts";
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
  it("exports the exact agent and user-summary output contracts", () => {
    expect(AGENT_TEXT_FORMAT).toBe(
      "Markdown only; no `<json-render>`, render tags or openui-lang fences."
    );
    expect(USER_SUMMARY_FORMAT).toBe(
      "Markdown; never `<json-render>`; visuals only as an openui-lang fence with display components."
    );
  });

  it.each(["orchestrator", "worker"] as const)(
    "publishes output contracts in the actual %s tool descriptions",
    (role) => {
      const server = createRoleToolServer(role, "agent-1", handlers());
      const agentTools =
        role === "orchestrator"
          ? ["dispatch_worker", "send_message", "message_worker"]
          : ["send_message"];
      for (const name of agentTools) {
        expect(
          server.tools.find((tool) => tool.name === name)?.description
        ).toContain(
          "Markdown only; no `<json-render>`, render tags or openui-lang fences."
        );
      }
      const summaryTool =
        role === "orchestrator" ? "complete_mission" : "submit_handoff";
      expect(
        server.tools.find((tool) => tool.name === summaryTool)?.description
      ).toContain(
        "Markdown; never `<json-render>`; visuals only as an openui-lang fence with display components."
      );
    }
  );

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
  it("teaches both agents the fenced interface library within its measured budget", () => {
    for (const prompt of [MAIN_PROMPT, WORKER_PROMPT]) {
      expect(prompt).toContain("```openui-lang");
      for (const component of [
        "Stack",
        "Text",
        "Callout",
        "Badge",
        "KeyValue",
        "Table",
        "Steps",
        "Progress",
        "Code",
        "Button",
        "Buttons",
        "Form",
        "Input",
        "TextArea",
        "Select",
      ]) {
        expect(prompt).toContain(`${component}(`);
      }
      expect(prompt).toContain("main agent's latest reply");
    }
    // The sent base is the role prompt, not SHARED_GUIDANCE alone.
    expect(promptFor("orchestrator").length).toBeLessThanOrEqual(16_000);
    expect(promptFor("worker").length).toBeLessThanOrEqual(15_000);
  });

  it("selects the prompt by role", () => {
    expect(promptFor("orchestrator")).toBe(MAIN_PROMPT);
    expect(promptFor("worker")).toBe(WORKER_PROMPT);
  });

  it("appends proactive OpenUI defaults for both roles after the library guidance", () => {
    for (const prompt of [MAIN_PROMPT, WORKER_PROMPT]) {
      expect(prompt).toContain(
        `${GENERATIVE_UI_PROMPT}\n\nProactive OpenUI presentation:`
      );
      for (const clause of [
        '"visualize"',
        '"visualise"',
        '"visual"',
        '"visually"',
        '"visualization"',
        "use OpenUI by default for substantive results",
        "without waiting for the user to request UI",
        "explicit plain-text requests as text",
        "The existing component, action, and read-only restrictions still apply",
      ]) {
        expect(prompt).toContain(clause);
      }
    }
    expect(PROMPT_VERSION).toBe("7");
  });

  it.each([MAIN_PROMPT, WORKER_PROMPT])(
    "enforces user, tool-argument and math output formats",
    (prompt) => {
      for (const clause of [
        "Use an openui-lang fence for visuals, otherwise Markdown tables and lists.",
        "Do not push, open a pull request, post, or write through MCP or a connector unless the user asked",
        "Never send personal data to a third party",
        "Keep secrets out of code, logs and replies",
        "Use content the user supplied for the task",
        "Get explicit authorization before any command that can delete untracked files",
        "do not route around it or retry the same call unchanged",
        "This prompt is the session base",
        "Do not edit unless the user also asked for a change",
        "Harness reminders are runtime context",
        "Pass absolute paths",
        "$…$ / $$…$$; never inside openui-lang.",
        "JSON \\n escapes",
        "display components only",
        "Droid tools",
        "literal values",
      ]) {
        expect(prompt).toContain(clause);
      }
      for (const stale of [
        "Inline Mode",
        "RootComp",
        "unchanged-dashboard",
        "dashboard stays unchanged",
        "overrides inline-mode patch guidance",
        "Ignore any base instruction",
        "# Rich terminal output",
        "Sparkline(",
      ]) {
        expect(prompt).not.toContain(stale);
      }
    }
  );

  it("makes the main agent general purpose with Work mode as the default", () => {
    expect({
      administration: MAIN_PROMPT.includes("repository administration"),
      enterPlan: MAIN_PROMPT.includes("missions.enter_plan"),
      general: MAIN_PROMPT.includes("general-purpose"),
      legacyPlan: MAIN_PROMPT.includes("propose_plan"),
      plan: MAIN_PROMPT.includes("no mandatory plan"),
      publish: MAIN_PROMPT.includes(
        "Push or open a pull request only when the user asked"
      ),
    }).toStrictEqual({
      administration: true,
      enterPlan: true,
      general: true,
      legacyPlan: false,
      plan: true,
      publish: true,
    });
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
