import { createSdkMcpServer, tool } from "@factory/droid-sdk/node";
import type { DroidTool, SdkMcpServer } from "@factory/droid-sdk/node";
import type { DeliveryMode, Role } from "@missions/protocol/common";
// The SDK tool helper expects Zod 3 shapes; app contracts use Zod 4.
import { z } from "zod3";

export const ROLE_TOOL_SERVER = "missions";

export interface TodoInput {
  content: string;
  status: "pending" | "in_progress" | "completed";
  priority: "high" | "medium" | "low";
}

export interface RoleToolHandlers {
  proposePlan: (
    agentId: string,
    input: { title: string; markdown: string }
  ) => Promise<string>;
  dispatchWorker: (
    agentId: string,
    input: { title: string; instructions: string; needsWrite: boolean }
  ) => Promise<string>;
  messageWorker: (
    agentId: string,
    input: { assignmentId: string; text: string; mode: DeliveryMode }
  ) => Promise<string>;
  updateTodos: (
    agentId: string,
    input: { todos: TodoInput[] }
  ) => Promise<string>;
  submitHandoff: (
    agentId: string,
    input: {
      summary: string;
      filesChanged: string[];
      checks: { command: string; outcome: string }[];
      followUps: string[];
    }
  ) => Promise<string>;
  completeMission: (
    agentId: string,
    input: { summary: string; checks: { command: string; outcome: string }[] }
  ) => Promise<string>;
  attachArtifact: (
    agentId: string,
    input: { path: string; name?: string | undefined }
  ) => Promise<string>;
}

const todoShape = z.object({
  content: z.string().min(1),
  priority: z.enum(["high", "medium", "low"]).default("medium"),
  status: z.enum(["pending", "in_progress", "completed"]),
});
const checkShape = z.object({ command: z.string(), outcome: z.string() });

const updateTodosTool = (agentId: string, handlers: RoleToolHandlers) =>
  tool(
    "update_todos",
    "Replace your todo list for this mission. Keep exactly one item in_progress while work remains.",
    { todos: z.array(todoShape).max(50) },
    async ({ todos }) => await handlers.updateTodos(agentId, { todos }),
    { annotations: { readOnlyHint: true } }
  );

const attachArtifactTool = (agentId: string, handlers: RoleToolHandlers) =>
  tool(
    "attach_artifact",
    "Show a file you produced (screenshot, recording, report) to the user as an artifact. The path must be inside the mission folder.",
    {
      name: z.string().min(1).max(200).optional(),
      path: z.string().min(1).max(4096),
    },
    async (input) => await handlers.attachArtifact(agentId, input),
    { annotations: { readOnlyHint: true } }
  );

const orchestratorTools = (
  agentId: string,
  handlers: RoleToolHandlers
): DroidTool[] => [
  tool(
    "propose_plan",
    "Submit the implementation plan for user approval. Do not modify files until the user approves this plan revision.",
    {
      markdown: z.string().min(1).max(50_000),
      title: z.string().min(1).max(200),
    },
    async (input) => await handlers.proposePlan(agentId, input),
    { annotations: { readOnlyHint: true } }
  ),
  tool(
    "dispatch_worker",
    "Assign a bounded task to a Worker agent. Workers share your workspace and branch. Set needsWrite=false for read-only analysis.",
    {
      instructions: z.string().min(1).max(20_000),
      needsWrite: z.boolean().default(true),
      title: z.string().min(1).max(200),
    },
    async (input) => await handlers.dispatchWorker(agentId, input),
    { annotations: { readOnlyHint: true } }
  ),
  tool(
    "message_worker",
    "Send a message to the Worker running an assignment. mode=steer delivers after its current tool call; mode=queue delivers after its current loop.",
    {
      assignmentId: z.string().min(1),
      mode: z.enum(["steer", "queue"]).default("steer"),
      text: z.string().min(1).max(20_000),
    },
    async (input) => await handlers.messageWorker(agentId, input),
    { annotations: { readOnlyHint: true } }
  ),
  updateTodosTool(agentId, handlers),
  attachArtifactTool(agentId, handlers),
  tool(
    "complete_mission",
    "Declare the mission complete after reviewing the shared changes and running final checks.",
    {
      checks: z.array(checkShape).max(50).default([]),
      summary: z.string().min(1).max(20_000),
    },
    async (input) => await handlers.completeMission(agentId, input),
    { annotations: { readOnlyHint: true } }
  ),
];

const workerTools = (
  agentId: string,
  handlers: RoleToolHandlers
): DroidTool[] => [
  updateTodosTool(agentId, handlers),
  attachArtifactTool(agentId, handlers),
  tool(
    "submit_handoff",
    "Finish your assignment: summarize what you changed and how you verified it. Call this exactly once when done.",
    {
      checks: z.array(checkShape).max(50).default([]),
      filesChanged: z.array(z.string()).max(500).default([]),
      followUps: z.array(z.string()).max(50).default([]),
      summary: z.string().min(1).max(20_000),
    },
    async (input) => await handlers.submitHandoff(agentId, input),
    { annotations: { readOnlyHint: true } }
  ),
];

export const createRoleToolServer = (
  role: Role,
  agentId: string,
  handlers: RoleToolHandlers
): SdkMcpServer =>
  createSdkMcpServer({
    name: ROLE_TOOL_SERVER,
    tools:
      role === "orchestrator"
        ? orchestratorTools(agentId, handlers)
        : workerTools(agentId, handlers),
    version: "1.0.0",
  });

/**
 * Any non-empty `disabledToolIds` makes the CLI fall back to a read-only tool
 * set, so the tools agents need are re-enabled explicitly (verified live).
 */
export const ENABLED_TOOL_IDS = [
  "Read",
  "LS",
  "Glob",
  "Grep",
  "Execute",
  "Edit",
  "Create",
  "ApplyPatch",
  "AskUser",
  "TodoWrite",
  "WebSearch",
  "FetchUrl",
];

/** Native tools that would bypass mission coordination or act outside it. */
export const DISABLED_TOOL_IDS = [
  "Task",
  "TaskOutput",
  "TaskStop",
  "ProposeMission",
  "StartMissionRun",
  "EndFeatureRun",
  "DismissHandoffItems",
  "Loop",
  "CreateAutomation",
  "EditAutomation",
  "DeleteAutomation",
  "RunAutomation",
  "ListAutomations",
  "ListAutomationTemplates",
  "ReadAutomation",
  "GenerateDroid",
  "StageSettingsChanges",
  "ExitSpecMode",
];

export const ORCHESTRATOR_PROMPT = `You are the Orchestrator of a Missions run. You and your Workers share ONE working directory and git branch.
Workflow:
1. Explore the repository read-only. Ask the user structured questions with AskUser only when a decision is genuinely ambiguous.
2. Call missions.propose_plan with a concise Markdown plan. File changes are blocked until the user approves that plan revision; wait for the approval message.
3. After approval, track progress with missions.update_todos and dispatch bounded tasks with missions.dispatch_worker. Only one agent may write at a time, so prefer sequential writable assignments.
4. Review Worker handoffs and the shared changes, run final checks, then call missions.complete_mission with a summary.
Never push, open pull requests, or commit: the user publishes from the Missions app.`;

export const WORKER_PROMPT = `You are a Worker in a Missions run. You share the Orchestrator's working directory and git branch; other agents may edit the same files, so re-read files before editing.
Do only your assignment. Track steps with missions.update_todos. When finished, call missions.submit_handoff once with a summary, the files you changed, and the checks you ran.
Never push, open pull requests, or commit.`;
