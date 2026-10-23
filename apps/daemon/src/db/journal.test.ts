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

  it.each([
    { kind: "test.effect", missionId: "mission-other" },
    { kind: "test.other", missionId: "mission-original" },
    { kind: "test.effect", missionId: null },
  ])(
    "rejects a reused ID with identity $kind / $missionId",
    async (identity) => {
      const journal = setup();
      const original = {
        id: "op-owned",
        kind: "test.effect",
        missionId: "mission-original",
      };
      await journal.run(original, () => Promise.resolve("original"));
      expect(() => journal.get(original.id, identity)).toThrow(
        /different action or mission/u
      );
      await expect(
        journal.run({ id: original.id, ...identity }, () =>
          Promise.resolve("wrong")
        )
      ).rejects.toThrow(/different action or mission/u);
      expect(journal.get(original.id, original)?.result).toBe("original");
    }
  );

  it("validates unknown identity before a caller can reconcile it", async () => {
    const journal = setup();
    await expect(
      journal.run(
        { ...spec("op-unknown"), missionId: "mission-original" },
        fail,
        { outcomeUnknown: () => true }
      )
    ).rejects.toThrow("boom");
    expect(() =>
      journal.get("op-unknown", {
        kind: "test.effect",
        missionId: "mission-other",
      })
    ).toThrow(/different action or mission/u);
    expect(journal.get("op-unknown")?.operation.status).toBe("unknown");
  });

  it.each(["succeeded", "failed", "reconciled"] as const)(
    "never replaces a terminal %s outcome or emits a new event for it",
    async (status) => {
      const store = new Store(openDatabase(":memory:"));
      const log = new EventLog(store);
      const journal = new OperationJournal(store, log);
      await expect(
        journal.run(spec("op-terminal"), fail, { outcomeUnknown: () => true })
      ).rejects.toThrow("boom");
      journal.reconcile("op-terminal", status, { durable: true }, "observed");
      const recorded = journal.get("op-terminal");
      const cursor = log.bounds(null).latest;
      expect(
        journal.reconcile(
          "op-terminal",
          "failed",
          { durable: false },
          "overwrite"
        )
      ).toStrictEqual(recorded?.operation);
      expect(journal.get("op-terminal")).toStrictEqual(recorded);
      expect(log.bounds(null).latest).toBe(cursor);
    }
  );

  it("supplies persisted intent to the effect and preserves it for reconciliation", async () => {
    const journal = setup();
    const detail = { branch: "original", expectedHead: "head-original" };
    await expect(
      journal.run(
        { ...spec("op-intent"), detail },
        (recorded) => {
          expect(recorded).toStrictEqual(detail);
          expect(recorded).not.toBe(detail);
          detail.branch = "changed";
          return fail();
        },
        { outcomeUnknown: () => true }
      )
    ).rejects.toThrow("boom");
    expect(journal.get("op-intent")?.operation.detail).toMatchObject({
      branch: "original",
      expectedHead: "head-original",
    });
    journal.reconcile("op-intent", "reconciled", "original-result");
    await expect(
      journal.run(
        {
          ...spec("op-intent"),
          detail: { branch: "retry", expectedHead: "stale" },
        },
        fail
      )
    ).resolves.toStrictEqual({ duplicate: true, result: "original-result" });
    expect(journal.get("op-intent")?.operation.detail.branch).toBe("original");
  });

  it("replays success despite changed transient preconditions", async () => {
    const journal = setup();
    await journal.run(
      { ...spec("op-replay"), detail: { expectedRevision: 1 } },
      () => Promise.resolve({ revision: 2 })
    );
    await expect(
      journal.run(
        { ...spec("op-replay"), detail: { expectedRevision: 999 } },
        fail
      )
    ).resolves.toStrictEqual({ duplicate: true, result: { revision: 2 } });
    expect(journal.get("op-replay")?.operation.detail).toStrictEqual({
      expectedRevision: 1,
    });
  });
});
