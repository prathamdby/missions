import { isApiError } from "./api-error";

/** Only an actual client rejection proves that the daemon did not act. */
export const isDefiniteFailure = (error: unknown) =>
  isApiError(error) && error.status >= 400 && error.status < 500;

/** One ID per logical intent, retained when the outcome is unknown. */
export class OperationIntents {
  private readonly ids = new Map<string, string>();
  private latest: string | undefined;
  private readonly newId: () => string;

  constructor(newId: () => string = () => crypto.randomUUID()) {
    this.newId = newId;
  }

  idFor(key: string): string {
    this.latest = key;
    const existing = this.ids.get(key);
    if (existing) {
      return existing;
    }
    const id = this.newId();
    this.ids.set(key, id);
    return id;
  }

  settle(key = this.latest): void {
    if (key !== undefined) {
      this.ids.delete(key);
      if (this.latest === key) {
        this.latest = undefined;
      }
    }
  }

  release(error: unknown, key = this.latest): void {
    if (isDefiniteFailure(error)) {
      this.settle(key);
    }
  }
}

/** Canonical, complete payload identity; object insertion order is irrelevant. */
export const operationIntentKey = (...parts: unknown[]): string =>
  JSON.stringify(parts, (_key, value: unknown) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }
    return Object.fromEntries(
      Object.entries(value).toSorted(([a], [b]) => a.localeCompare(b))
    );
  });

/** Shared synchronous admission for both mutation entry points. */
export const createSingleFlight = () => {
  let pending: symbol | null = null;
  const enter = () => {
    if (pending !== null) {
      return null;
    }
    const ticket = Symbol("mutation");
    pending = ticket;
    return ticket;
  };
  const leave = (ticket = pending) => {
    if (ticket === pending) {
      pending = null;
    }
  };
  return {
    leave: () => leave(),
    mutate: (run: () => void): void => {
      const ticket = enter();
      if (!ticket) {
        return;
      }
      try {
        run();
      } catch (error) {
        leave(ticket);
        throw error;
      }
    },
    mutateAsync: async <T>(run: () => Promise<T>): Promise<T> => {
      const ticket = enter();
      if (!ticket) {
        throw new Error("A mutation is already in flight.");
      }
      try {
        return await run();
      } finally {
        // React Query can publish settlement before this promise resolves.
        // Never let this older finalizer unlock a newer admitted mutation.
        leave(ticket);
      }
    },
  };
};
