import { LeaseAbortedError } from "./lease-aborted-error";

export { LeaseAbortedError } from "./lease-aborted-error";

/**
 * One writable agent turn per workspace at a time. Keyed by canonical
 * workspace path so separate missions bound to the same checkout also
 * serialize. Read-only work never takes the lease.
 */
interface Waiter {
  holder: string;
  resolve: (value: undefined) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
}

interface Lane {
  holder: string | null;
  waiters: Waiter[];
}

export class WriteLeaseRegistry {
  readonly #lanes = new Map<string, Lane>();
  readonly #onChange:
    | ((workspace: string, holder: string | null) => void)
    | undefined;

  constructor(onChange?: (workspace: string, holder: string | null) => void) {
    this.#onChange = onChange;
  }

  #lane(workspace: string) {
    let lane = this.#lanes.get(workspace);
    if (!lane) {
      lane = { holder: null, waiters: [] };
      this.#lanes.set(workspace, lane);
    }
    return lane;
  }

  holder(workspace: string) {
    return this.#lanes.get(workspace)?.holder ?? null;
  }

  waiting(workspace: string) {
    return (
      this.#lanes.get(workspace)?.waiters.map((waiter) => waiter.holder) ?? []
    );
  }

  /** Re-entrant for the current holder. */
  acquire(
    workspace: string,
    holder: string,
    signal?: AbortSignal
  ): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(new LeaseAbortedError());
    }
    const lane = this.#lane(workspace);
    if (lane.holder === null || lane.holder === holder) {
      const changed = lane.holder !== holder;
      lane.holder = holder;
      if (changed) {
        this.#onChange?.(workspace, holder);
      }
      return Promise.resolve();
    }
    const { promise, resolve, reject } = Promise.withResolvers<undefined>();
    const waiter: Waiter = {
      cleanup: () => {
        /* No listener until queued below. */
      },
      holder,
      reject,
      resolve,
    };
    const abort = () => {
      const index = lane.waiters.indexOf(waiter);
      if (index !== -1) {
        lane.waiters.splice(index, 1);
        waiter.cleanup();
        reject(new LeaseAbortedError());
      }
    };
    waiter.cleanup = () => signal?.removeEventListener("abort", abort);
    lane.waiters.push(waiter);
    signal?.addEventListener("abort", abort, { once: true });
    return promise;
  }

  release(workspace: string, holder: string) {
    const lane = this.#lanes.get(workspace);
    if (!lane || lane.holder !== holder) {
      return false;
    }
    const next = lane.waiters.shift();
    next?.cleanup();
    lane.holder = next?.holder ?? null;
    if (!next) {
      this.#lanes.delete(workspace);
    }
    this.#onChange?.(workspace, lane.holder);
    next?.resolve(undefined);
    return true;
  }

  /** Cancels queued acquisitions without releasing a still-running writer. */
  cancelWaits(holder: string) {
    for (const lane of this.#lanes.values()) {
      for (const waiter of lane.waiters.filter(
        (candidate) => candidate.holder === holder
      )) {
        lane.waiters.splice(lane.waiters.indexOf(waiter), 1);
        waiter.cleanup();
        waiter.reject(new LeaseAbortedError());
      }
    }
  }

  /** Drops a confirmed-stopped holder everywhere and cancels its waits. */
  forget(holder: string) {
    this.cancelWaits(holder);
    for (const [workspace, lane] of this.#lanes) {
      if (lane.holder === holder) {
        this.release(workspace, holder);
      }
    }
  }
}
