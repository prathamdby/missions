import type { Store } from "../db/store";
import type { ProcessRecord } from "./process-supervisor";

const PROCESS_PREFIX = "process:";

/** Durable launch ownership, independent of mission orchestration. */
export class ProcessRecordRepository {
  readonly #store: Store;

  constructor(store: Store) {
    this.#store = store;
  }

  save(record: ProcessRecord | null, agentId: string) {
    if (record) {
      this.#store.putSetting(`${PROCESS_PREFIX}${agentId}`, record);
    } else {
      this.delete(agentId);
    }
  }

  list(agentIds?: Iterable<string>): ProcessRecord[] {
    const ids = agentIds === undefined ? null : new Set(agentIds);
    return this.#store
      .settingsWithPrefix<ProcessRecord>(PROCESS_PREFIX)
      .map(({ value }) => value)
      .filter((record) => ids === null || ids.has(record.agentId));
  }

  delete(agentId: string) {
    this.#store.deleteSetting(`${PROCESS_PREFIX}${agentId}`);
  }
}
