import type { Operation } from "@missions/protocol/missions";

import type { EventLog } from "../events/event-log";
import { AppError, conflict } from "../lib/app-error";
import { errorMessage } from "../lib/async";
import type { Store } from "./store";

export interface OperationIdentity {
  kind: string;
  missionId: string | null;
}

export interface OperationSpec extends OperationIdentity {
  id: string;
  detail?: Record<string, unknown>;
}

export interface RunOptions {
  /** Errors for which the external effect may have happened anyway. */
  outcomeUnknown?: (error: unknown) => boolean;
}

const replayRecorded = <T>(
  operation: Operation,
  result: unknown
): { result: T; duplicate: boolean } => {
  if (operation.status === "succeeded" || operation.status === "reconciled") {
    return { duplicate: true, result: result as T };
  }
  if (operation.status === "failed") {
    const reason = operation.detail.error;
    throw new AppError(
      "conflict",
      `This action already failed${typeof reason === "string" ? `: ${reason}` : ""}. Start a new attempt.`
    );
  }
  throw conflict(
    "This action's outcome is not known yet. Reconcile before trying again."
  );
};

/**
 * Write-ahead journal for effects outside SQLite (SDK, git, gh, filesystem).
 * The intent is committed before the effect runs and the observed result
 * after. A repeated operation ID returns the recorded result; an operation
 * whose outcome is unknown is never retried automatically.
 */
export class OperationJournal {
  readonly #store: Store;
  readonly #log: EventLog;
  readonly #now: () => Date;

  constructor(store: Store, log: EventLog, now: () => Date = () => new Date()) {
    this.#store = store;
    this.#log = log;
    this.#now = now;
  }

  #save(operation: Operation, result: unknown = null) {
    this.#log.commit((emit) => {
      this.#store.putOperation(operation, result);
      emit(operation.missionId, {
        data: { operation },
        type: "operation.updated",
      });
    });
    return operation;
  }

  get(id: string, identity?: OperationIdentity) {
    const existing = this.#store.getOperation(id);
    if (
      existing &&
      identity &&
      (existing.operation.kind !== identity.kind ||
        existing.operation.missionId !== identity.missionId)
    ) {
      throw conflict(
        "This operation ID was used for a different action or mission"
      );
    }
    return existing;
  }

  /** The recorded outcome of a repeated operation ID, or null for a new one. */
  replay<T>(spec: OperationSpec): { result: T; duplicate: boolean } | null {
    const existing = this.get(spec.id, spec);
    return existing
      ? replayRecorded<T>(existing.operation, existing.result)
      : null;
  }

  /**
   * Records a database-only operation as succeeded inside the caller's
   * transaction, so the receipt commits or rolls back with its effect. It
   * emits nothing: the caller decides which stream, if any, learns about it.
   */
  recordCompleted(spec: OperationSpec, result: unknown = null): Operation {
    const at = this.#now().toISOString();
    const operation: Operation = {
      createdAt: at,
      detail: structuredClone(spec.detail ?? {}),
      id: spec.id,
      kind: spec.kind,
      missionId: spec.missionId,
      status: "succeeded",
      updatedAt: at,
    };
    this.#store.transaction(() => {
      if (this.#store.getOperation(spec.id)) {
        throw conflict("This operation ID was already used");
      }
      this.#store.putOperation(operation, result);
    });
    return operation;
  }

  async run<T>(
    spec: OperationSpec,
    effect: (detail: Record<string, unknown>) => Promise<T>,
    options: RunOptions = {}
  ): Promise<{ result: T; duplicate: boolean }> {
    const existing = this.get(spec.id, spec);
    if (existing) {
      return replayRecorded<T>(existing.operation, existing.result);
    }
    const at = this.#now().toISOString();
    const intent: Operation = {
      createdAt: at,
      detail: structuredClone(spec.detail ?? {}),
      id: spec.id,
      kind: spec.kind,
      missionId: spec.missionId,
      status: "intent",
      updatedAt: at,
    };
    this.#save(intent);
    try {
      // Read the persisted representation, not a caller-owned retry payload.
      const detail = this.get(spec.id, spec)?.operation.detail ?? {};
      const result = await effect(detail);
      this.#save(
        {
          ...intent,
          status: "succeeded",
          updatedAt: this.#now().toISOString(),
        },
        result ?? null
      );
      return { duplicate: false, result };
    } catch (error) {
      const unknown = options.outcomeUnknown?.(error) ?? false;
      this.#save({
        ...intent,
        detail: { ...intent.detail, error: errorMessage(error) },
        status: unknown ? "unknown" : "failed",
        updatedAt: this.#now().toISOString(),
      });
      throw error;
    }
  }

  /** Marks the outcome of an unknown operation after checking the real system. */
  reconcile(
    id: string,
    status: "succeeded" | "failed" | "reconciled",
    result: unknown = null,
    note?: string
  ) {
    const existing = this.#store.getOperation(id);
    if (!existing) {
      return null;
    }
    if (
      existing.operation.status !== "intent" &&
      existing.operation.status !== "unknown"
    ) {
      return existing.operation;
    }
    return this.#save(
      {
        ...existing.operation,
        detail: note
          ? { ...existing.operation.detail, reconciliation: note }
          : existing.operation.detail,
        status,
        updatedAt: this.#now().toISOString(),
      },
      result
    );
  }

  /** After a crash, in-flight intents have unknown outcomes. */
  recoverInterrupted(): Operation[] {
    return this.#store.listOperations(["intent"]).map((operation) =>
      this.#save({
        ...operation,
        detail: {
          ...operation.detail,
          error: "Daemon stopped during this action",
        },
        status: "unknown",
        updatedAt: this.#now().toISOString(),
      })
    );
  }

  unresolved(missionId?: string) {
    return this.#store
      .listOperations(["intent", "unknown"])
      .filter((operation) => !missionId || operation.missionId === missionId);
  }
}
