/**
 * Browser performance marks for the message path (submit → receipt → first
 * painted output). Marks are visible in the Performance panel and through
 * `performance.getEntriesByType("mark")`; nothing is logged.
 */

const PREFIX = "missions:";
/** Bounds the once-only bookkeeping on long-lived pages. */
const MAX_TRACKED = 500;

const marked = new Set<string>();
/** The latest accepted message, so first output can be keyed by its queue item. */
let awaitingOutput: string | null = null;
const outputMarked = new Set<string>();

const canMark = () =>
  typeof performance !== "undefined" && typeof performance.mark === "function";

const remember = (set: Set<string>, key: string) => {
  if (set.size >= MAX_TRACKED) {
    set.clear();
  }
  set.add(key);
};

const mark = (name: string, detail?: Record<string, string>) => {
  if (!canMark()) {
    return;
  }
  try {
    performance.mark(`${PREFIX}${name}`, detail ? { detail } : undefined);
  } catch {
    // A mark is diagnostic only; it must never break the interaction.
  }
};

/** The user pressed send; `occurrence` is the client-side intent ID. */
export const markSubmit = (occurrence: string) => {
  mark(`submit:${occurrence}`, { occurrence });
};

/** The daemon durably accepted the message as queue item `requestId`. */
export const markReceipt = (requestId: string, occurrence?: string) => {
  const name = `receipt:${requestId}`;
  if (marked.has(name)) {
    return;
  }
  remember(marked, name);
  awaitingOutput = requestId;
  mark(name, occurrence ? { occurrence, requestId } : { requestId });
};

/**
 * The first streamed assistant or thinking text painted after the latest
 * receipt. Later previews for the same message are ignored.
 */
export const markFirstOutput = (
  kind: "text" | "thinking",
  messageId: string
) => {
  const request = awaitingOutput;
  if (request === null || !canMark()) {
    return;
  }
  const key = `${kind}:${request}`;
  if (outputMarked.has(key)) {
    return;
  }
  remember(outputMarked, key);
  requestAnimationFrame(() =>
    mark(
      `first-${kind === "text" ? "assistant-delta" : "thinking"}:${request}`,
      {
        messageId,
        requestId: request,
      }
    )
  );
};
