import type {
  Agent,
  Assignment,
  PermissionRequest,
  PlanRevision,
  Question,
  TranscriptItem,
} from "@missions/protocol/missions";

import { previewText } from "../live/mission-state";
import type { PreviewKind, StreamingPreview } from "../live/mission-state";
import { toolCardKind } from "./tool-output";

export interface ToolCall {
  call: TranscriptItem | null;
  id: string;
  result: TranscriptItem | null;
}

type MessageKind =
  | "agent_message"
  | "assistant"
  | "error"
  | "system"
  | "thinking"
  | "user";

export type TimelineEntry =
  | { agentId: string; id: string; item: TranscriptItem; kind: MessageKind }
  | { agentId: string; calls: ToolCall[]; id: string; kind: "tools" }
  | {
      agentId: string;
      id: string;
      kind: "preview";
      previewKind: PreviewKind;
      text: string;
    }
  | {
      agentId: string | null;
      id: string;
      kind: "permission";
      request: PermissionRequest;
    }
  | {
      agentId: null;
      id: string;
      kind: "plan";
      latest: boolean;
      plan: PlanRevision;
    }
  | { agentId: string; id: string; kind: "question"; question: Question }
  | {
      agentId: null;
      assignment: Assignment;
      id: string;
      kind: "assignment";
    }
  | { agentId: null; id: string; kind: "plan_approved"; plan: PlanRevision };

type CardEntry = Extract<
  TimelineEntry,
  {
    kind: "assignment" | "permission" | "plan" | "plan_approved" | "question";
  }
>;

interface TimelineInput {
  planAgentId?: string;
  planInFlight?: boolean;
  assignments?: readonly Assignment[];
  permissions: readonly PermissionRequest[];
  plans: readonly PlanRevision[];
  previews: readonly StreamingPreview[];
  questions: readonly Question[];
  transcript: readonly TranscriptItem[];
}

/** Daemon-to-agent instructions; they stay in the agent's context, not the chat. */
const AGENT_PROMPT_PREFIX = "[Missions]";

export const isAgentPrompt = (item: TranscriptItem) =>
  item.kind === "system" && item.text.startsWith(AGENT_PROMPT_PREFIX);

const isTool = (item: TranscriptItem) =>
  item.kind === "tool_call" || item.kind === "tool_result";

/**
 * Mission role tools surface as their own cards (plan, todos, assignments,
 * agent messages, finish), so their raw calls stay out of the tool groups.
 * Native ExitSpecMode is the plan card. Droid may prefix MCP tool names with
 * the server name. propose_plan only appears in legacy transcripts.
 */
const ROLE_TOOL =
  /(?:^|[._])(?:send_message|message_worker|dispatch_worker|submit_handoff|enter_plan|read_history|update_todos|attach_artifact|complete_mission|propose_plan|ExitSpecMode)$/u;

export const isRoleTool = (name: string | null) =>
  name !== null && ROLE_TOOL.test(name);

const EXPLORE_TOOLS = new Set([
  "FetchUrl",
  "Glob",
  "Grep",
  "LS",
  "Read",
  "WebSearch",
]);
const EDIT_TOOLS = new Set(["ApplyPatch", "Create", "Edit", "MultiEdit"]);

/** Paper groups reads and searches apart from commands and edits. */
export const toolCategory = (name: string | null) => {
  if (name === null) {
    return "other";
  }
  if (EXPLORE_TOOLS.has(name)) {
    return "explore";
  }
  if (EDIT_TOOLS.has(name)) {
    return "edit";
  }
  return name === "Execute" ? "run" : "other";
};

/**
 * Role tool calls, and the results of calls already hidden; records hidden
 * calls by tool use ID. A failed role call produced no card or agent message,
 * so it comes back as an ordinary tool call with its error.
 */
const hiddenTool = (
  item: TranscriptItem,
  hidden: Map<string, TranscriptItem>
): "hide" | "show" | TranscriptItem => {
  if (item.kind === "tool_call" && isRoleTool(item.toolName)) {
    if (item.toolUseId) {
      hidden.set(item.toolUseId, item);
    }
    return "hide";
  }
  if (item.kind !== "tool_result" || item.toolUseId === null) {
    return "show";
  }
  const call = hidden.get(item.toolUseId);
  if (!call) {
    return "show";
  }
  return item.isError ? call : "hide";
};

/** Groups consecutive tool calls per agent and pairs results with their call. */
const transcriptEntries = (items: readonly TranscriptItem[]) => {
  const out: { at: string; entry: TimelineEntry }[] = [];
  const calls = new Map<string, ToolCall>();
  const hidden = new Map<string, TranscriptItem>();
  let group: Extract<TimelineEntry, { kind: "tools" }> | null = null;
  let category = "other";

  for (const item of items) {
    if (isAgentPrompt(item)) {
      continue;
    }
    const role = hiddenTool(item, hidden);
    if (role === "hide") {
      continue;
    }
    if (role !== "show") {
      group = null;
      out.push({
        at: role.createdAt,
        entry: {
          agentId: item.agentId,
          calls: [{ call: role, id: role.id, result: item }],
          id: `tools:${role.id}`,
          kind: "tools",
        },
      });
      continue;
    }
    if (!isTool(item)) {
      group = null;
      out.push({
        at: item.createdAt,
        entry: {
          agentId: item.agentId,
          id: item.id,
          item,
          kind: item.kind as MessageKind,
        },
      });
      continue;
    }
    const match =
      item.kind === "tool_result" && item.toolUseId
        ? calls.get(item.toolUseId)
        : undefined;
    if (match && match.result === null) {
      match.result = item;
      continue;
    }
    const nextCategory =
      item.kind === "tool_call" ? toolCategory(item.toolName) : category;
    if (
      group === null ||
      group.agentId !== item.agentId ||
      nextCategory !== category
    ) {
      category = nextCategory;
      group = {
        agentId: item.agentId,
        calls: [],
        id: `tools:${item.id}`,
        kind: "tools",
      };
      out.push({ at: item.createdAt, entry: group });
    }
    const entry: ToolCall =
      item.kind === "tool_call"
        ? { call: item, id: item.id, result: null }
        : { call: null, id: item.id, result: item };
    group.calls.push(entry);
    if (item.kind === "tool_call" && item.toolUseId) {
      calls.set(item.toolUseId, entry);
    }
  }
  return out;
};

const planPosition = (input: TimelineInput, plan: PlanRevision) => {
  let at = plan.createdAt;
  const [nextPlan] = input.plans
    .filter((candidate) => candidate.revision > plan.revision)
    .toSorted((a, b) => a.revision - b.revision);
  const cutoff = plan.decidedAt ?? nextPlan?.createdAt;
  for (const item of input.transcript) {
    if (
      input.planAgentId &&
      item.agentId === input.planAgentId &&
      item.kind === "assistant" &&
      item.createdAt > at &&
      (!cutoff || item.createdAt < cutoff)
    ) {
      at = item.createdAt;
    }
  }
  return at;
};

const cardEntries = (input: TimelineInput) => {
  const latestPlan = Math.max(0, ...input.plans.map((plan) => plan.revision));
  const cards: { at: string; entry: CardEntry }[] = [
    ...input.questions.map((question) => ({
      at: question.createdAt,
      entry: {
        agentId: question.agentId,
        id: `question:${question.id}`,
        kind: "question" as const,
        question,
      },
    })),
    ...input.permissions.map((request) => ({
      at: request.createdAt,
      entry: {
        agentId: request.agentId,
        id: `permission:${request.id}`,
        kind: "permission" as const,
        request,
      },
    })),
    ...input.plans
      // A legacy proposal waits for the agent to finish its turn; a native
      // proposal is bound while the agent is still mid-turn.
      .filter(
        (plan) =>
          !(
            plan.status === "proposed" &&
            input.planInFlight &&
            !plan.actionable
          )
      )
      .map((plan) => ({
        at: planPosition(input, plan),
        entry: {
          agentId: null,
          id: `plan:${plan.id}`,
          kind: "plan" as const,
          latest: plan.revision === latestPlan,
          plan,
        },
      })),
    ...input.plans.flatMap((plan) =>
      plan.status === "approved" && plan.decidedAt
        ? [
            {
              at: plan.decidedAt,
              entry: {
                agentId: null,
                id: `approved:${plan.id}`,
                kind: "plan_approved" as const,
                plan,
              },
            },
          ]
        : []
    ),
    ...(input.assignments ?? []).map((assignment) => ({
      at: assignment.createdAt,
      entry: {
        agentId: null,
        assignment,
        id: `assignment:${assignment.id}`,
        kind: "assignment" as const,
      },
    })),
  ];
  return cards.toSorted((a, b) => a.at.localeCompare(b.at));
};

const firstSeq = (preview: StreamingPreview) =>
  Math.min(...Object.keys(preview.chunks).map(Number));

/**
 * One ordered list for the chat column: transcript in seq order, decision
 * cards slotted in by time, and in-flight previews last.
 */
export const buildTimeline = (input: TimelineInput): TimelineEntry[] => {
  const transcript = transcriptEntries(
    input.transcript.toSorted((a, b) => a.seq - b.seq)
  );
  const cards = cardEntries(input);
  const out: TimelineEntry[] = [];
  let next = 0;
  for (const { at, entry } of transcript) {
    while (
      next < cards.length &&
      ((cards[next]?.at ?? "") < at ||
        ((cards[next]?.at ?? "") === at && cards[next]?.entry.kind !== "plan"))
    ) {
      const card = cards[next];
      if (card) {
        out.push(card.entry);
      }
      next += 1;
    }
    out.push(entry);
  }
  for (const card of cards.slice(next)) {
    out.push(card.entry);
  }
  for (const preview of input.previews.toSorted(
    (a, b) => firstSeq(a) - firstSeq(b)
  )) {
    out.push({
      agentId: preview.agentId,
      id: `preview:${preview.messageId}`,
      kind: "preview",
      previewKind: preview.kind,
      text: previewText(preview),
    });
  }
  return out;
};

export type TranscriptRow =
  | { entry: TimelineEntry; id: string; kind: "entry" }
  | { id: string; items: TranscriptItem[]; kind: "messages" }
  | { groups: ToolCall[][]; id: string; kind: "tools"; tail: boolean }
  | {
      calls: ToolCall[];
      card: "command" | "edit" | "ran";
      id: string;
      kind: "card";
    };

/** Worker narration and tool calls live in their assignment card, as in Paper S22. */
const WORKER_HIDDEN = new Set<TimelineEntry["kind"]>([
  "assistant",
  "preview",
  "thinking",
  "tools",
]);

const pairKey = (item: TranscriptItem) =>
  [item.sender?.agentId ?? item.agentId, item.recipient?.agentId ?? ""]
    .toSorted()
    .join("|");

/** Messages between the same two agents, in either direction. */
const samePair = (first: TranscriptItem | undefined, next: TranscriptItem) =>
  first !== undefined && pairKey(first) === pairKey(next);

/**
 * Folds consecutive tool groups from one agent into a single run, and
 * consecutive agent messages between one pair into an exchange. Any other
 * row in between, such as a user message, starts a new exchange. Lone
 * commands and edits break out as their own cards.
 */
export const transcriptRows = (
  entries: readonly TimelineEntry[],
  running: boolean,
  agents: Readonly<Record<string, Pick<Agent, "role">>> = {}
): TranscriptRow[] => {
  const rows: TranscriptRow[] = [];
  for (const entry of entries) {
    if (
      entry.agentId !== null &&
      WORKER_HIDDEN.has(entry.kind) &&
      agents[entry.agentId]?.role === "worker"
    ) {
      continue;
    }
    const last = rows.at(-1);
    if (entry.kind === "agent_message") {
      if (last?.kind === "messages" && samePair(last.items[0], entry.item)) {
        last.items.push(entry.item);
      } else {
        rows.push({ id: entry.id, items: [entry.item], kind: "messages" });
      }
      continue;
    }
    if (entry.kind !== "tools") {
      rows.push({ entry, id: entry.id, kind: "entry" });
      continue;
    }
    const card = toolCardKind(entry.calls, running);
    if (card) {
      rows.push({ calls: entry.calls, card, id: entry.id, kind: "card" });
      continue;
    }
    if (last?.kind === "tools" && last.id.startsWith(`${entry.agentId}|`)) {
      last.groups.push(entry.calls);
      continue;
    }
    rows.push({
      groups: [entry.calls],
      id: `${entry.agentId}|${entry.id}`,
      kind: "tools",
      tail: false,
    });
  }
  const lastRow = rows.at(-1);
  if (lastRow?.kind === "tools") {
    lastRow.tail = true;
  }
  return rows;
};
