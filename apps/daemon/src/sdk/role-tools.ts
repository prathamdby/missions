import { createSdkMcpServer, tool } from "@factory/droid-sdk/node";
import type { DroidTool, SdkMcpServer } from "@factory/droid-sdk/node";
import type { Role } from "@missions/protocol/common";
// The SDK tool helper expects Zod 3 shapes; app contracts use Zod 4.
import { z } from "zod3";

import { AGENT_TEXT_FORMAT, USER_SUMMARY_FORMAT } from "./prompts";

export const ROLE_TOOL_SERVER = "missions";

/** Agent message bodies; larger reports belong in shared files. */
export const MAX_AGENT_MESSAGE = 20_000;
export const MAIN_RECIPIENT = "main";

export interface TodoInput {
  content: string;
  status: "pending" | "in_progress" | "completed";
  priority: "high" | "medium" | "low";
}

export interface SendMessageInput {
  messageId: string;
  to: string;
  text: string;
}

export interface HistoryInput {
  before?: number | undefined;
  limit?: number | undefined;
}

export interface RoleToolHandlers {
  dispatchWorker: (
    agentId: string,
    input: { title: string; instructions: string; needsWrite: boolean }
  ) => Promise<string>;
  sendMessage: (agentId: string, input: SendMessageInput) => Promise<string>;
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
  enterPlan: (
    agentId: string,
    input: { reason?: string | undefined }
  ) => Promise<string>;
  readHistory: (agentId: string, input: HistoryInput) => Promise<string>;
}

const todoShape = z.object({
  content: z.string().min(1),
  priority: z.enum(["high", "medium", "low"]).default("medium"),
  status: z.enum(["pending", "in_progress", "completed"]),
});
const checkShape = z.object({ command: z.string(), outcome: z.string() });
const MESSAGE_ID = /^[\w.:-]{1,64}$/u;

const updateTodosTool = (agentId: string, handlers: RoleToolHandlers) =>
  tool(
    "update_todos",
    "Replace your todo list for this mission. Keep exactly one item in_progress while work remains. Native TodoWrite updates the same list.",
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

const sendMessageTool = (
  agentId: string,
  handlers: RoleToolHandlers,
  role: Role
) =>
  tool(
    "send_message",
    role === "orchestrator"
      ? `Send a message to a running Worker. to is the Worker's assignment id. It is delivered at the Worker's next tool boundary. messageId is your idempotency key: use a new one per message and reuse it only to retry the same message. Text format: ${AGENT_TEXT_FORMAT}`
      : `Send a message to the main agent (to="main"): a question, blocker or progress note. It is delivered at the main agent's next tool boundary. messageId is your idempotency key: use a new one per message and reuse it only to retry the same message. Text format: ${AGENT_TEXT_FORMAT}`,
    {
      messageId: z
        .string()
        .regex(MESSAGE_ID, "Use 1-64 letters, digits, '.', ':', '_' or '-'"),
      text: z.string().min(1).max(MAX_AGENT_MESSAGE),
      to: z.string().min(1).max(128),
    },
    async (input) => await handlers.sendMessage(agentId, input),
    { annotations: { readOnlyHint: true } }
  );

const readHistoryTool = (agentId: string, handlers: RoleToolHandlers) =>
  tool(
    "read_history",
    "Read this mission's earlier conversation (all agents), newest page first, read-only. Use it after a session transition or when earlier context is missing. Pass before=<seq> from a previous page to go further back.",
    {
      before: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(100).default(40),
    },
    async (input) => await handlers.readHistory(agentId, input),
    { annotations: { readOnlyHint: true } }
  );

const orchestratorTools = (
  agentId: string,
  handlers: RoleToolHandlers
): DroidTool[] => [
  tool(
    "dispatch_worker",
    `Assign a bounded task to a Worker agent that shares your workspace and branch. Its reports and handoff arrive as messages; end your turn while you wait. Set needsWrite=false for research or review. Instructions format: ${AGENT_TEXT_FORMAT}`,
    {
      instructions: z.string().min(1).max(20_000),
      needsWrite: z.boolean().default(true),
      title: z.string().min(1).max(200),
    },
    async (input) => await handlers.dispatchWorker(agentId, input),
    { annotations: { readOnlyHint: true } }
  ),
  sendMessageTool(agentId, handlers, "orchestrator"),
  tool(
    "message_worker",
    `Deprecated alias of send_message: sends text to the Worker running assignmentId. Prefer send_message. Text format: ${AGENT_TEXT_FORMAT}`,
    {
      assignmentId: z.string().min(1),
      mode: z.enum(["steer", "queue"]).default("steer"),
      text: z.string().min(1).max(MAX_AGENT_MESSAGE),
    },
    async (input) =>
      await handlers.sendMessage(agentId, {
        messageId: `alias-${crypto.randomUUID()}`,
        text: input.text,
        to: input.assignmentId,
      }),
    { annotations: { readOnlyHint: true } }
  ),
  tool(
    "enter_plan",
    "Switch to Plan mode for the user's current request: all agents become read-only and you will continue in Spec mode with planning guidance, ending with ExitSpecMode for user approval. Call this, then end your turn.",
    { reason: z.string().max(2000).optional() },
    async (input) => await handlers.enterPlan(agentId, input),
    { annotations: { readOnlyHint: true } }
  ),
  updateTodosTool(agentId, handlers),
  attachArtifactTool(agentId, handlers),
  readHistoryTool(agentId, handlers),
  tool(
    "complete_mission",
    `Finish the whole mission after verifying the work: stops every agent so the user can review and publish. Not needed after each request. Summary format: ${USER_SUMMARY_FORMAT}`,
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
  sendMessageTool(agentId, handlers, "worker"),
  readHistoryTool(agentId, handlers),
  tool(
    "submit_handoff",
    `Finish your assignment: summarize what you changed and how you verified it. Call this exactly once when done. Summary format: ${USER_SUMMARY_FORMAT}`,
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
    version: "2.0.0",
  });

/**
 * Any non-empty `disabledToolIds` makes the CLI fall back to a read-only tool
 * set, so the tools agents need are re-enabled explicitly (verified live).
 */
const BASE_ENABLED_TOOL_IDS = [
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

/**
 * The only deliberate routing exclusions: native subagents and built-in
 * Factory Missions would create a second, invisible fleet, and automations or
 * settings staging act outside the mission.
 */
const BASE_DISABLED_TOOL_IDS = [
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
];

/** Only the main agent plans; its native ExitSpecMode is the approval bridge. */
export const enabledToolIds = (role: Role) =>
  role === "orchestrator"
    ? [...BASE_ENABLED_TOOL_IDS, "ExitSpecMode"]
    : BASE_ENABLED_TOOL_IDS;

export const disabledToolIds = (role: Role) =>
  role === "orchestrator"
    ? BASE_DISABLED_TOOL_IDS
    : [...BASE_DISABLED_TOOL_IDS, "ExitSpecMode"];
