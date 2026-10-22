import { describe, expect, it } from "vitest";

import { openDatabase } from "../db/database";
import { Store } from "../db/store";
import { EventLog } from "./event-log";

const notice = (message: string) =>
  ({
    data: {
      notice: { code: "info", level: "info", message, retryAfterMs: null },
    },
    type: "notice",
  }) as const;

const setup = (retainPerStream?: number) => {
  const store = new Store(openDatabase(":memory:"));
  return new EventLog(store, { retainPerStream });
};

describe(EventLog, () => {
  it("broadcasts only after commit and drops events from rolled-back work", () => {
    const log = setup();
    const seen: number[] = [];
    log.subscribe((event) => seen.push(event.seq));
    expect(() =>
      log.commit((emit) => {
        emit(null, notice("lost"));
        throw new Error("rollback");
      })
    ).toThrow("rollback");
    log.commit((emit) => {
      emit(null, notice("a"));
      expect(seen).toStrictEqual([]);
      emit(null, notice("b"));
    });
    expect(seen).toStrictEqual([1, 2]);
    expect(log.replay(null, 0).map((event) => event.seq)).toStrictEqual([1, 2]);
  });

  it("keeps one gap-free sequence per mission stream", () => {
    const log = setup();
    log.publish("m1", notice("x"));
    log.publish("m2", notice("y"));
    log.publish("m1", notice("z"));
    expect(log.replay("m1", 0).map((event) => event.seq)).toStrictEqual([1, 2]);
    expect(log.replay("m2", 0).map((event) => event.seq)).toStrictEqual([1]);
    expect(log.replay("m1", 1).map((event) => event.seq)).toStrictEqual([2]);
  });

  it("prunes from the front so retained history stays contiguous", () => {
    const log = setup(2);
    for (const message of ["1", "2", "3", "4"]) {
      log.publish(null, notice(message));
    }
    expect(log.prune(null)).toBe(2);
    expect(log.bounds(null)).toStrictEqual({ latest: 4, oldest: 3 });
  });
});
