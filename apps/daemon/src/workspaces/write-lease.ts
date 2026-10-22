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
    const lane = this.#lane(workspace);
    if (lane.holder === null || lane.holder === holder) {
      const changed = lane.holder !== holder;
      lane.holder = holder;
      if (changed) {
        this.#onChange?.(workspace, holder);
      }
      return Promise.resolve();
    }
    if (signal?.aborted) {
      return Promise.reject(new LeaseAbortedError());
    }
    const { promise, resolve, reject } = Promise.withResolvers<undefined>();
    const waiter: Waiter = { holder, reject, resolve };
    lane.waiters.push(waiter);
    signal?.addEventListener(
      "abort",
      () => {
        const index = lane.waiters.indexOf(waiter);
        if (index !== -1) {
          lane.waiters.splice(index, 1);
          reject(new LeaseAbortedError());
        }
      },
      { once: true }
    );
    return promise;
  }

  release(workspace: string, holder: string) {
    const lane = this.#lanes.get(workspace);
    if (!lane || lane.holder !== holder) {
      return false;
    }
    const next = lane.waiters.shift();
    lane.holder = next?.holder ?? null;
    this.#onChange?.(workspace, lane.holder);
    next?.resolve(undefined);
    return true;
  }

  /** Drops a holder everywhere and cancels its waits (agent closed or paused). */
  forget(holder: string) {
    for (const [workspace, lane] of this.#lanes) {
      for (const waiter of lane.waiters.filter((w) => w.holder === holder)) {
        lane.waiters.splice(lane.waiters.indexOf(waiter), 1);
        waiter.reject(new LeaseAbortedError());
      }
      if (lane.holder === holder) {
        this.release(workspace, holder);
      }
    }
  }
}
