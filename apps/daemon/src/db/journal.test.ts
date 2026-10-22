import { describe, expect, it } from "vitest";

import { EventLog } from "../events/event-log";
import { openDatabase } from "./database";
import { OperationJournal } from "./journal";
import { Store } from "./store";

const setup = () => {
  const store = new Store(openDatabase(":memory:"));
  return new OperationJournal(store, new EventLog(store));
};

const fail = () => Promise.reject(new Error("boom"));

const spec = (id: string) => ({ id, kind: "test.effect", missionId: null });

describe(OperationJournal, () => {
  it("runs an effect once and replays its recorded result", async () => {
    const journal = setup();
    let calls = 0;
    const effect = () => {
      calls += 1;
      return Promise.resolve({ calls });
    };
    await expect(journal.run(spec("op-1-abc"), effect)).resolves.toStrictEqual({
      duplicate: false,
      result: { calls: 1 },
    });
    await expect(journal.run(spec("op-1-abc"), effect)).resolves.toStrictEqual({
      duplicate: true,
      result: { calls: 1 },
    });
    expect(calls).toBe(1);
  });

  it("never retries failed or unknown outcomes under the same ID", async () => {
    const journal = setup();
    await expect(journal.run(spec("op-fail-1"), fail)).rejects.toThrow("boom");
    await expect(journal.run(spec("op-fail-1"), fail)).rejects.toThrow(
      /already failed/u
    );
    await expect(
      journal.run(spec("op-unk-1"), fail, { outcomeUnknown: () => true })
    ).rejects.toThrow("boom");
    expect(journal.get("op-unk-1")?.operation.status).toBe("unknown");
    await expect(journal.run(spec("op-unk-1"), fail)).rejects.toThrow(
      /not known/u
    );
  });

  it("marks in-flight intents unknown after a crash", async () => {
    const journal = setup();
    const { promise, resolve } = Promise.withResolvers<undefined>();
    const running = journal.run(spec("op-crash"), () => promise);
    expect(journal.recoverInterrupted().map((op) => op.status)).toStrictEqual([
      "unknown",
    ]);
    resolve(undefined);
    await running;
  });
});
