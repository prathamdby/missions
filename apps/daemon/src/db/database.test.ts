import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Mission } from "@missions/protocol/missions";
import { describe, expect, it } from "vitest";

import { openDatabase } from "./database";
import { Store } from "./store";

const tempFile = async (name: string) =>
  path.join(await mkdtemp(path.join(tmpdir(), "missions-db-")), name);

const LEGACY_MISSION = {
  autonomy: "medium",
  createdAt: "2026-01-01T00:00:00.000Z",
  epoch: 0,
  goal: "Fix it",
  id: "m-legacy",
  lastError: null,
  orchestrator: { modelId: "m", reasoningEffort: null },
  projectId: "p-1",
  publish: {
    cleanup: "none",
    cleanupReason: null,
    commits: [],
    pr: null,
    pushedBranch: null,
    remote: null,
  },
  revision: 3,
  status: "completed",
  summary: null,
  title: "Fix it",
  updatedAt: "2026-01-01T01:00:00.000Z",
  worker: { modelId: "m", reasoningEffort: null },
  workspace: null,
};

describe(openDatabase, () => {
  it("reopens its own database and keeps the data", async () => {
    const file = await tempFile("missions.db");
    const first = openDatabase(file);
    first.sqlite.prepare("CREATE TABLE probe (value TEXT)").run();
    first.sqlite.prepare("INSERT INTO probe VALUES ('kept')").run();
    first.close();
    const second = openDatabase(file);
    const row = second.sqlite.prepare("SELECT value FROM probe").get();
    second.close();
    expect(row).toStrictEqual({ value: "kept" });
  });

  it("refuses a database written by a newer version", async () => {
    const file = await tempFile("missions.db");
    const handle = openDatabase(file);
    handle.sqlite
      .prepare(
        "INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('future', ?)"
      )
      .run(Date.now() + 86_400_000);
    handle.close();
    expect(() => openDatabase(file)).toThrow(/newer version of Missions/u);
  });

  it("names a file that is not a database instead of crashing obscurely", async () => {
    const file = await tempFile("missions.db");
    await writeFile(
      file,
      "definitely not sqlite, just some text padding ".repeat(20)
    );
    expect(() => openDatabase(file)).toThrow(/is not a Missions database/u);
  });

  it("reads missions stored before endedAt existed", () => {
    const store = new Store(openDatabase(":memory:"));
    store.putMission(LEGACY_MISSION as unknown as Mission);
    expect([
      store.getMission("m-legacy")?.endedAt,
      store.listMissions().map((mission) => mission.endedAt),
    ]).toStrictEqual([null, [null]]);
  });
});
