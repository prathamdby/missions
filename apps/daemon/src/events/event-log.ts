import type { DaemonEvent, EventBody } from "@missions/protocol/events";
import { and, asc, eq, gt, lt, max, min } from "drizzle-orm";

import { events } from "../db/schema";
import type { Store } from "../db/store";

type Listener = (event: DaemonEvent) => void;
export type Emit = (missionId: string | null, body: EventBody) => DaemonEvent;

export interface EventLogOptions {
  now?: () => Date;
  /** Events kept per stream; older ones are pruned from the front. */
  retainPerStream?: number;
}

const streamOf = (missionId: string | null) => missionId ?? "";
/** Retention is enforced every this many appends to a stream, inside the appending transaction. */
const PRUNE_INTERVAL = 1000;

/**
 * Persist-then-broadcast event log. State writes and their events share one
 * SQLite transaction; listeners only see events after the commit, so a
 * subscriber can never observe state that was rolled back.
 */
export class EventLog {
  readonly #store: Store;
  readonly #now: () => Date;
  readonly #retain: number;
  readonly #listeners = new Set<Listener>();
  #pending: DaemonEvent[] = [];
  #depth = 0;

  constructor(store: Store, options: EventLogOptions = {}) {
    this.#store = store;
    this.#now = options.now ?? (() => new Date());
    this.#retain = options.retainPerStream ?? 20_000;
  }

  readonly #append: Emit = (missionId, body) => {
    const stream = streamOf(missionId);
    const [row] = this.#store.db
      .select({ value: max(events.seq) })
      .from(events)
      .where(eq(events.stream, stream))
      .all();
    const event = {
      ...body,
      at: this.#now().toISOString(),
      missionId,
      seq: (row?.value ?? 0) + 1,
    } as DaemonEvent;
    this.#store.db
      .insert(events)
      .values({
        at: event.at,
        data: event,
        seq: event.seq,
        stream,
        type: event.type,
      })
      .run();
    if (event.seq % PRUNE_INTERVAL === 0) {
      this.prune(missionId);
    }
    this.#pending.push(event);
    return event;
  };

  commit<T>(fn: (emit: Emit) => T): T {
    const mark = this.#pending.length;
    this.#depth += 1;
    try {
      return this.#store.transaction(() => fn(this.#append));
    } catch (error) {
      this.#pending.length = mark;
      throw error;
    } finally {
      this.#depth -= 1;
      if (this.#depth === 0) {
        this.#flush();
      }
    }
  }

  publish(missionId: string | null, body: EventBody) {
    return this.commit((emit) => emit(missionId, body));
  }

  #flush() {
    const ready = this.#pending;
    this.#pending = [];
    for (const event of ready) {
      for (const listener of this.#listeners) {
        listener(event);
      }
    }
  }

  subscribe(listener: Listener) {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  bounds(missionId: string | null) {
    const [row] = this.#store.db
      .select({ latest: max(events.seq), oldest: min(events.seq) })
      .from(events)
      .where(eq(events.stream, streamOf(missionId)))
      .all();
    return { latest: row?.latest ?? 0, oldest: row?.oldest ?? 0 };
  }

  replay(missionId: string | null, after: number, limit = 500): DaemonEvent[] {
    return this.#store.db
      .select()
      .from(events)
      .where(and(eq(events.stream, streamOf(missionId)), gt(events.seq, after)))
      .orderBy(asc(events.seq))
      .limit(limit)
      .all()
      .map((row) => row.data as DaemonEvent);
  }

  pruneAll() {
    const streams = this.#store.db
      .selectDistinct({ stream: events.stream })
      .from(events)
      .all();
    let removed = 0;
    for (const { stream } of streams) {
      removed += this.prune(stream === "" ? null : stream);
    }
    return removed;
  }

  /** Drops the oldest events beyond the retention budget, keeping each stream contiguous. */
  prune(missionId: string | null) {
    const { latest } = this.bounds(missionId);
    const cutoff = latest - this.#retain;
    if (cutoff <= 0) {
      return 0;
    }
    return this.#store.db
      .delete(events)
      .where(
        and(eq(events.stream, streamOf(missionId)), lt(events.seq, cutoff + 1))
      )
      .run().changes;
  }
}
