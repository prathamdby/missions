import { describe, expect, it } from "vitest";

import { openDatabase } from "../db/database";
import { Store } from "../db/store";
import { ProcessRecordRepository } from "./process-record-repository";

describe(ProcessRecordRepository, () => {
  it("reads legacy keys, filters agents, enriches launch records and deletes", () => {
    const db = openDatabase(":memory:");
    try {
      const store = new Store(db);
      const repository = new ProcessRecordRepository(store);
      const legacy = {
        agentId: "old",
        pid: 41,
        startTime: "100",
        tag: "legacy-tag",
      };
      store.putSetting("process:old", legacy);
      const launch = { agentId: "new", pid: 42, startTime: "", tag: "tag" };
      repository.save(launch, "new");
      expect(repository.list(["old"])).toStrictEqual([legacy]);
      expect(repository.list()).toHaveLength(2);
      repository.save({ ...launch, startTime: "101" }, "new");
      expect(repository.list(new Set(["new"]))[0]?.startTime).toBe("101");
      repository.save(null, "old");
      repository.delete("new");
      expect(repository.list()).toStrictEqual([]);
    } finally {
      db.close();
    }
  });
});
