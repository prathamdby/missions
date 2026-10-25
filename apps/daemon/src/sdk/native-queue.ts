import type { DeliveryMode } from "@missions/protocol/common";
import type { QueueItemState } from "@missions/protocol/missions";

/**
 * Mirrors what the daemon has observed about native queued messages. The SDK
 * runner owns delivery; this never re-sends anything. Observations can arrive
 * out of order (a consumption notification may precede the add response), so
 * terminal states are never regressed by later, weaker evidence.
 */

export interface NativeQueueEntry {
  id: string;
  text: string;
  mode: DeliveryMode;
  state: QueueItemState;
  error: string | null;
}

export interface NativeQueueSnapshot {
  /** Native queued request IDs reported by `loadSession`. */
  queuedIds: string[] | undefined;
  /** Request IDs the runner admitted, including those already drained. */
  pendingIds: string[] | undefined;
  /** Request IDs observed as user messages in the restored transcript. */
  consumedIds: ReadonlySet<string>;
}

const TERMINAL: ReadonlySet<QueueItemState> = new Set([
  "sent",
  "removed",
  "discarded",
  "failed",
]);
const TERMINAL_RETENTION = 256;

export class NativeQueueTracker {
  readonly #entries = new Map<string, NativeQueueEntry>();
  readonly #onChange: (entry: NativeQueueEntry) => void;
  readonly #terminalLimit: number;
  readonly #terminal = new Set<string>();
  readonly #retained = new Map<string, number>();

  constructor(
    onChange: (entry: NativeQueueEntry) => void,
    terminalLimit = TERMINAL_RETENTION
  ) {
    this.#onChange = onChange;
    this.#terminalLimit = terminalLimit;
  }

  get(id: string) {
    return this.#entries.get(id) ?? null;
  }

  list() {
    return [...this.#entries.values()];
  }

  /** Restores mirrored entries after a daemon restart without emitting. */
  hydrate(entries: NativeQueueEntry[]) {
    for (const entry of entries) {
      this.#entries.set(entry.id, { ...entry });
      this.#trackTerminal(entry);
    }
  }

  /** Protect identities participating in an in-flight adapter operation. */
  retain(id: string) {
    this.#retained.set(id, (this.#retained.get(id) ?? 0) + 1);
    return () => {
      const count = (this.#retained.get(id) ?? 1) - 1;
      if (count === 0) {
        this.#retained.delete(id);
      } else {
        this.#retained.set(id, count);
      }
      this.#prune();
    };
  }

  #trackTerminal(entry: NativeQueueEntry) {
    this.#terminal.delete(entry.id);
    if (TERMINAL.has(entry.state)) {
      this.#terminal.add(entry.id);
    }
    this.#prune();
  }

  #prune() {
    for (const id of this.#terminal) {
      if (this.#terminal.size <= this.#terminalLimit) {
        break;
      }
      if (!this.#retained.has(id)) {
        this.#terminal.delete(id);
        this.#entries.delete(id);
      }
    }
  }

  #update(id: string, patch: Partial<NativeQueueEntry>) {
    const entry = this.#entries.get(id);
    if (!entry) {
      return null;
    }
    Object.assign(entry, patch);
    this.#onChange({ ...entry });
    this.#trackTerminal(entry);
    return entry;
  }

  submitted(id: string, text: string, mode: DeliveryMode) {
    const entry: NativeQueueEntry = {
      error: null,
      id,
      mode,
      state: "submitting",
      text,
    };
    this.#entries.set(id, entry);
    this.#trackTerminal(entry);
    this.#onChange({ ...entry });
  }

  /** The add response is `{}`: admission, not proof of consumption. */
  admitted(id: string) {
    const entry = this.#entries.get(id);
    if (entry?.state === "submitting" || entry?.state === "unknown") {
      this.#update(id, { error: null, state: "queued" });
    }
  }

  /**
   * A definite protocol rejection means the runner never admitted the message.
   * A transport failure or timeout leaves the outcome unknown.
   */
  submitFailed(id: string, error: string, outcomeKnown: boolean) {
    const entry = this.#entries.get(id);
    if (!entry || TERMINAL.has(entry.state)) {
      return;
    }
    this.#update(id, { error, state: outcomeKnown ? "failed" : "unknown" });
  }

  consumed(id: string) {
    const entry = this.#entries.get(id);
    if (!entry || entry.state === "sent") {
      return;
    }
    // Consumption wins over an earlier removal claim: the agent saw it.
    this.#update(id, {
      error:
        entry.state === "removed" || entry.state === "removing"
          ? "Delivered before removal took effect"
          : entry.error,
      state: "sent",
    });
  }

  /**
   * Discard notifications may omit the request ID. Only an unambiguous text
   * match is attributed; ambiguous matches become `unknown` for reconciliation.
   */
  discarded(id: string | undefined, text: string) {
    if (id) {
      const entry = this.#entries.get(id);
      if (entry && entry.state !== "sent") {
        this.#update(id, { state: "discarded" });
      }
      return;
    }
    const open = this.list().filter((entry) => !TERMINAL.has(entry.state));
    const exact = open.filter((entry) => entry.text === text);
    if (exact.length === 1 && exact[0]) {
      this.#update(exact[0].id, { state: "discarded" });
      return;
    }
    const candidates =
      exact.length > 1
        ? exact
        : open.filter((entry) => text.includes(entry.text));
    for (const entry of candidates) {
      this.#update(entry.id, {
        error: "Discard could not be attributed to one request",
        state: "unknown",
      });
    }
  }

  removing(id: string) {
    const entry = this.#entries.get(id);
    if (entry && !TERMINAL.has(entry.state)) {
      this.#update(id, { state: "removing" });
    }
  }

  removeConfirmed(id: string) {
    const entry = this.#entries.get(id);
    if (entry && entry.state !== "sent" && entry.state !== "discarded") {
      this.#update(id, { error: null, state: "removed" });
    }
  }

  /** A failed delete leaves the message possibly still queued or consumed. */
  removeFailed(id: string, error: string) {
    const entry = this.#entries.get(id);
    if (entry?.state === "removing") {
      this.#update(id, { error, state: "unknown" });
    }
  }

  modeChanged(id: string, mode: DeliveryMode) {
    const entry = this.#entries.get(id);
    if (entry && !TERMINAL.has(entry.state)) {
      this.#update(id, { mode });
    }
  }

  /**
   * Compares mirrored entries with native state after `loadSession`. Missing
   * entries are never resubmitted: they become sent or unknown.
   */
  reconcile(snapshot: NativeQueueSnapshot) {
    const queued = new Set(snapshot.queuedIds);
    const pending = new Set(snapshot.pendingIds);
    for (const entry of this.list()) {
      if (snapshot.consumedIds.has(entry.id)) {
        this.consumed(entry.id);
        continue;
      }
      if (TERMINAL.has(entry.state)) {
        continue;
      }
      if (queued.has(entry.id)) {
        if (entry.state !== "queued") {
          this.#update(entry.id, { error: null, state: "queued" });
        }
      } else if (pending.has(entry.id)) {
        this.#update(entry.id, { state: "sent" });
      } else if (
        snapshot.queuedIds !== undefined &&
        entry.state === "removing"
      ) {
        this.#update(entry.id, { error: null, state: "removed" });
      } else {
        this.#update(entry.id, {
          error: "Not found in the restored native queue",
          state: "unknown",
        });
      }
    }
  }
}
