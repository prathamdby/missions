import type {
  PermissionRequest,
  PlanRevision,
  Question,
  TranscriptItem,
} from "@missions/protocol/missions";

import { previewText } from "../live/mission-state";
import type { PreviewKind, StreamingPreview } from "../live/mission-state";

export interface ToolCall {
  call: TranscriptItem | null;
  id: string;
  result: TranscriptItem | null;
}

type MessageKind = "assistant" | "error" | "system" | "thinking" | "user";

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
  | { agentId: string; id: string; kind: "question"; question: Question };

type CardEntry = Extract<
  TimelineEntry,
  { kind: "permission" | "plan" | "question" }
>;

interface TimelineInput {
  permissions: readonly PermissionRequest[];
  plans: readonly PlanRevision[];
  previews: readonly StreamingPreview[];
  questions: readonly Question[];
  transcript: readonly TranscriptItem[];
}

const isTool = (item: TranscriptItem) =>
  item.kind === "tool_call" || item.kind === "tool_result";

/** Groups consecutive tool calls per agent and pairs results with their call. */
const transcriptEntries = (items: readonly TranscriptItem[]) => {
  const out: { at: string; entry: TimelineEntry }[] = [];
  const calls = new Map<string, ToolCall>();
  let group: Extract<TimelineEntry, { kind: "tools" }> | null = null;

  for (const item of items) {
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
    if (group === null || group.agentId !== item.agentId) {
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
    ...input.plans.map((plan) => ({
      at: plan.createdAt,
      entry: {
        agentId: null,
        id: `plan:${plan.id}`,
        kind: "plan" as const,
        latest: plan.revision === latestPlan,
        plan,
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
    while (next < cards.length && (cards[next]?.at ?? "") <= at) {
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
