/**
 * Correlated, content-free stage timings. Records carry identifiers, stage
 * names and durations only: never prompt text, message bodies, tokens or
 * tool inputs.
 */
export interface TimingRecord {
  /** Correlation ID: a queue item/request ID or an agent startup ID. */
  traceId: string;
  stage: string;
  /** Wall-clock epoch milliseconds. */
  at: number;
  /** Milliseconds since the first record of this trace. */
  sinceStartMs: number;
  missionId: string | null;
  agentId: string | null;
  detail?: Record<string, string | number | boolean | null>;
}

export type TimingSink = (record: TimingRecord) => void;

const TRACE_LIMIT = 1024;

export interface TimingIds {
  missionId?: string | null;
  agentId?: string | null;
}

export class TimingLog {
  readonly #sinks: TimingSink[];
  readonly #starts = new Map<string, number>();
  readonly #once = new Set<string>();
  readonly #now: () => number;

  constructor(sinks: TimingSink[] = [], now: () => number = Date.now) {
    this.#sinks = sinks;
    this.#now = now;
  }

  mark(
    traceId: string,
    stage: string,
    ids: TimingIds = {},
    detail?: TimingRecord["detail"]
  ) {
    if (this.#sinks.length === 0) {
      return;
    }
    const at = this.#now();
    let start = this.#starts.get(traceId);
    if (start === undefined) {
      start = at;
      this.#starts.set(traceId, at);
      if (this.#starts.size > TRACE_LIMIT) {
        const [oldest] = this.#starts.keys();
        if (oldest !== undefined) {
          this.#starts.delete(oldest);
        }
      }
    }
    const record: TimingRecord = {
      agentId: ids.agentId ?? null,
      at,
      missionId: ids.missionId ?? null,
      sinceStartMs: at - start,
      stage,
      traceId,
      ...(detail ? { detail } : {}),
    };
    for (const sink of this.#sinks) {
      try {
        sink(record);
      } catch {
        // Instrumentation never affects mission behavior.
      }
    }
  }

  /** Marks a stage at most once per trace, e.g. the first streamed text. */
  markOnce(
    traceId: string,
    stage: string,
    ids: TimingIds = {},
    detail?: TimingRecord["detail"]
  ) {
    if (this.#sinks.length === 0) {
      return;
    }
    const key = `${traceId}\u0000${stage}`;
    if (this.#once.has(key)) {
      return;
    }
    this.#once.add(key);
    if (this.#once.size > TRACE_LIMIT * 8) {
      const [oldest] = this.#once;
      if (oldest !== undefined) {
        this.#once.delete(oldest);
      }
    }
    this.mark(traceId, stage, ids, detail);
  }

  /** Measures an async stage; the outcome is recorded without its value. */
  async span<T>(
    traceId: string,
    stage: string,
    ids: TimingIds,
    effect: () => Promise<T>
  ): Promise<T> {
    if (this.#sinks.length === 0) {
      return await effect();
    }
    const started = this.#now();
    try {
      const value = await effect();
      this.mark(traceId, stage, ids, {
        durationMs: this.#now() - started,
        ok: true,
      });
      return value;
    } catch (error) {
      this.mark(traceId, stage, ids, {
        durationMs: this.#now() - started,
        ok: false,
      });
      throw error;
    }
  }
}

/** `MISSIONS_TIMING=1` writes JSON lines to stderr for local diagnosis. */
export const timingSinksFromEnv = (
  env: NodeJS.ProcessEnv = process.env
): TimingSink[] =>
  env.MISSIONS_TIMING === "1"
    ? [
        (record) => {
          process.stderr.write(`[timing] ${JSON.stringify(record)}\n`);
        },
      ]
    : [];
