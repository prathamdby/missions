import type { TranscriptItem } from "@missions/protocol/missions";

import type { RuntimeMessage } from "../sdk/agent-runtime";

export type NewTranscriptItem = Omit<TranscriptItem, "seq">;

/** Tool output beyond this is cut in the transcript; the full result stays in the Droid session. */
const MAX_TOOL_OUTPUT = 64_000;

export const textItemId = (
  agentId: string,
  messageId: string,
  kind: "text" | "thinking"
) => `${agentId}:${messageId}:${kind}`;

export const toolItemId = (
  agentId: string,
  toolUseId: string,
  kind: "call" | "result"
) => `${agentId}:tool:${toolUseId}:${kind}`;

const clip = (text: string) =>
  text.length > MAX_TOOL_OUTPUT
    ? `${text.slice(0, MAX_TOOL_OUTPUT)}\n… ${text.length - MAX_TOOL_OUTPUT} more characters not shown`
    : text;

interface Base {
  agentId: string;
  missionId: string;
  createdAt: string;
}

const item = (
  base: Base,
  fields: Partial<NewTranscriptItem> &
    Pick<NewTranscriptItem, "id" | "kind" | "text">
): NewTranscriptItem => ({
  ...base,
  isError: false,
  requestId: null,
  toolName: null,
  toolUseId: null,
  ...fields,
});

export const toolCallItem = (
  base: Base,
  toolUseId: string,
  name: string,
  input: unknown
) =>
  item(base, {
    id: toolItemId(base.agentId, toolUseId, "call"),
    kind: "tool_call",
    text: name,
    toolInput: input,
    toolName: name,
    toolUseId,
  });

export const toolResultItem = (
  base: Base,
  toolUseId: string,
  content: string,
  isError: boolean
) =>
  item(base, {
    id: toolItemId(base.agentId, toolUseId, "result"),
    isError,
    kind: "tool_result",
    text: clip(content),
    toolUseId,
  });

/** Maps one SDK message to transcript items with stable IDs, so replays deduplicate. */
export const itemsFromMessage = (
  base: Base,
  message: RuntimeMessage
): NewTranscriptItem[] => {
  const items: NewTranscriptItem[] = [];
  if (message.thinking) {
    items.push(
      item(base, {
        id: textItemId(base.agentId, message.id, "thinking"),
        kind: "thinking",
        text: message.thinking,
      })
    );
  }
  if (message.text) {
    const kind = message.role === "assistant" ? "assistant" : message.role;
    items.push(
      item(base, {
        id: textItemId(base.agentId, message.id, "text"),
        kind,
        requestId: message.requestId,
        text: message.text,
      })
    );
  }
  for (const use of message.toolUses) {
    items.push(toolCallItem(base, use.id, use.name, use.input));
  }
  for (const result of message.toolResults) {
    items.push(
      toolResultItem(base, result.toolUseId, result.content, result.isError)
    );
  }
  return items;
};

interface PendingDelta {
  agentId: string;
  kind: "text" | "thinking";
  text: string;
}

/** Batches streaming deltas so the event log grows per interval, not per token. */
export class DeltaCoalescer {
  readonly #pending = new Map<string, PendingDelta>();
  readonly #flush: (itemId: string, delta: PendingDelta) => void;
  readonly #intervalMs: number;
  #timer: NodeJS.Timeout | null = null;

  constructor(
    flush: (itemId: string, delta: PendingDelta) => void,
    intervalMs = 150
  ) {
    this.#flush = flush;
    this.#intervalMs = intervalMs;
  }

  push(
    itemId: string,
    agentId: string,
    kind: "text" | "thinking",
    text: string
  ) {
    const existing = this.#pending.get(itemId);
    if (existing) {
      existing.text += text;
    } else {
      this.#pending.set(itemId, { agentId, kind, text });
    }
    this.#timer ??= setTimeout(() => this.flushAll(), this.#intervalMs);
  }

  /** The authoritative item arrived: unsent preview text is no longer needed. */
  drop(itemId: string) {
    this.#pending.delete(itemId);
  }

  flushAll() {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    const ready = [...this.#pending];
    this.#pending.clear();
    for (const [itemId, delta] of ready) {
      if (delta.text) {
        this.#flush(itemId, delta);
      }
    }
  }

  dispose() {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    this.#pending.clear();
  }
}
