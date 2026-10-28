import type { TranscriptItem } from "@missions/protocol/missions";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "./database";
import { Store } from "./store";

const item = (id: string, extra: Partial<TranscriptItem> = {}) => ({
  agentId: "orchestrator",
  createdAt: "2026-01-01T00:00:00.000Z",
  id,
  isError: false,
  kind: "user" as const,
  missionId: "mission-1",
  purpose: null,
  recipient: null,
  requestId: id,
  sender: null,
  text: id,
  toolName: null,
  toolUseId: null,
  ...extra,
});

describe("transcript queries", () => {
  let store: Store;
  beforeEach(() => {
    store = new Store(openDatabase(":memory:"));
  });
  afterEach(() => {
    store.handle.close();
  });

  it("counts visible rows toward a page while retaining intervening sequences", () => {
    store.appendTranscript(item("older"));
    store.appendTranscript(item("edited"));
    store.appendTranscript(item("hidden", { superseded: true }));
    store.appendTranscript(item("current", { superseded: false }));
    const first = store.transcriptPage("mission-1", null, 2);
    expect(first.items.map((row) => row.id)).toStrictEqual([
      "edited",
      "hidden",
      "current",
    ]);
    expect(first.hasMore).toBeTruthy();
    const older = store.transcriptPage(
      "mission-1",
      first.items[0]?.seq ?? 0,
      2
    );
    expect(older.items.map((row) => row.id)).toStrictEqual(["older"]);
    expect(older.hasMore).toBeFalsy();
  });

  it("finds only a visible user request in the named mission", () => {
    store.appendTranscript(item("legacy"));
    store.appendTranscript(item("current", { superseded: false }));
    store.appendTranscript(item("hidden", { superseded: true }));
    store.appendTranscript(item("system", { kind: "system" }));
    store.appendTranscript(item("foreign", { missionId: "mission-2" }));
    expect(
      ["legacy", "current", "hidden", "system", "foreign", "missing"].map(
        (id) => store.hasUserTranscriptRequest("mission-1", id)
      )
    ).toStrictEqual([true, true, false, false, false, false]);
  });

  it("indexes the mission and request lookup", () => {
    const plan = store.handle.sqlite
      .prepare(
        "EXPLAIN QUERY PLAN SELECT id FROM transcript WHERE mission_id = ? AND json_extract(data, '$.requestId') = ?"
      )
      .all("mission-1", "request-1");
    expect(JSON.stringify(plan)).toContain("transcript_mission_request_idx");
  });
});
