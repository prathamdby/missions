import type { TranscriptItem } from "@missions/protocol/missions";

import type { RuntimeMessage } from "../runtime/contracts";

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
  purpose: null,
  recipient: null,
  requestId: null,
  sender: null,
  toolName: null,
  toolUseId: null,
  ...fields,
});

const agentMessageItemId = (queueItemId: string) => `${queueItemId}:message`;

/**
 * The one canonical record of an agent-to-agent message. Both participants'
 * views project it; the recipient's native echo never adds a second record.
 */
export const agentMessageItem = (
  base: Base,
  message: {
    queueItemId: string;
    purpose: NonNullable<NewTranscriptItem["purpose"]>;
    sender: NonNullable<NewTranscriptItem["sender"]>;
    recipient: NonNullable<NewTranscriptItem["recipient"]>;
    text: string;
  }
) =>
  item(base, {
    id: agentMessageItemId(message.queueItemId),
    kind: "agent_message",
    purpose: message.purpose,
    recipient: message.recipient,
    requestId: message.queueItemId,
    sender: message.sender,
    text: message.text,
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
  if (message.text || (message.role === "user" && message.requestId !== null)) {
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
  generation: string;
  kind: "text" | "thinking";
  text: string;
}

const DELTA_INTERVAL_MS = 50;
/** Bounds the started-item memory; a forgotten item only loses its immediate first flush. */
const STARTED_LIMIT = 512;

/**
 * Batches streaming deltas so the event log grows per interval, not per
 * token. The first delta of each item is published immediately: time to
 * first visible text should not pay the batching interval.
 */
export class DeltaCoalescer {
  readonly #pending = new Map<string, PendingDelta>();
  readonly #started = new Map<string, string>();
  readonly #flush: (itemId: string, delta: PendingDelta) => void;
  readonly #intervalMs: number;
  #timer: NodeJS.Timeout | null = null;

  constructor(
    flush: (itemId: string, delta: PendingDelta) => void,
    intervalMs = DELTA_INTERVAL_MS
  ) {
    this.#flush = flush;
    this.#intervalMs = intervalMs;
  }

  push(
    itemId: string,
    agentId: string,
    kind: "text" | "thinking",
    text: string,
    generation: string
  ) {
    if (!text) {
      return;
    }
    if (!this.#started.has(itemId)) {
      this.#started.set(itemId, generation);
      if (this.#started.size > STARTED_LIMIT) {
        const [oldest] = this.#started.keys();
        if (oldest !== undefined) {
          this.#started.delete(oldest);
        }
      }
      this.#flush(itemId, { agentId, generation, kind, text });
      return;
    }
    const existing = this.#pending.get(itemId);
    if (existing) {
      existing.text += text;
    } else {
      this.#pending.set(itemId, { agentId, generation, kind, text });
    }
    this.#timer ??= setTimeout(() => this.flushAll(), this.#intervalMs);
  }

  /** The authoritative item arrived: unsent preview text is no longer needed. */
  drop(itemId: string) {
    this.#pending.delete(itemId);
    // Keep the started mark: a late delta for a finalized item must not
    // resurrect a preview through the immediate path.
  }

  dropGeneration(generation: string) {
    for (const [id, delta] of this.#pending) {
      if (delta.generation === generation) {
        this.#pending.delete(id);
      }
    }
    for (const [id, owner] of this.#started) {
      if (owner === generation) {
        this.#started.delete(id);
      }
    }
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
    this.#started.clear();
  }
}
