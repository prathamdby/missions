import { copyFile } from "node:fs/promises";

import type { DaemonEvent } from "@missions/protocol/events";
import { MissionSchema } from "@missions/protocol/missions";
import { routes } from "@missions/protocol/routes";
import { describe, expect, it } from "vitest";

import { createDaemon } from "../daemon";
import { openDatabase } from "../db/database";
import { OperationJournal } from "../db/journal";
import { Store } from "../db/store";
import { EventLog } from "../events/event-log";
import { testConfig } from "../test/fixtures";

const AT = "2026-10-25T12:00:00.000Z";
const now = () => new Date(AT);

describe("architecture compatibility", () => {
  it("keeps exact historical permission HTTP results, revisions, events, receipts and reopen documents", async () => {
    const config = await testConfig();
    const daemon = await createDaemon({
      config,
      loadModels: () => Promise.resolve([]),
      now,
      version: "architecture-oracle",
    });
    const seen: DaemonEvent[] = [];
    const unsubscribe = daemon.log.subscribe((event) => seen.push(event));
    const mission = {
      ...MissionSchema.parse({
        createdAt: AT,
        endedAt: null,
        epoch: 2,
        executionMode: "work",
        goal: "Keep the architecture compatible",
        id: "architecture-mission",
        lastError: null,
        orchestrator: { modelId: "fixture", reasoningEffort: null },
        projectId: "architecture-project",
        publish: {
          cleanup: "none",
          cleanupReason: null,
          commits: [],
          pr: null,
          pushedBranch: null,
          remote: null,
        },
        revision: 7,
        status: "paused",
        summary: null,
        title: "Before publishing",
        updatedAt: AT,
        worker: { modelId: "fixture", reasoningEffort: null },
        workspace: null,
      }),
      unknownFixtureField: { keep: ["unknown", 42] },
    };
    try {
      daemon.store.putMission(mission);
      daemon.store.permissions.put({
        agentId: null,
        allowAlways: true,
        createdAt: AT,
        decidedAt: null,
        decision: null,
        epoch: 2,
        id: "historical-approval",
        kind: "tool",
        missionId: mission.id,
        reason: null,
        status: "pending",
        toolUses: [],
      });
      const sendPermission = async (requestId: string) => {
        const response = await daemon.app.request(
          routes.permission(mission.id, requestId),
          {
            body: JSON.stringify({ decision: "always_allow", epoch: 2 }),
            headers: {
              authorization: `Bearer ${daemon.token}`,
              "content-type": "application/json",
              host: `127.0.0.1:${config.port}`,
            },
            method: "POST",
          }
        );
        return { body: await response.json(), status: response.status };
      };
      const responses = [
        await sendPermission("historical-approval"),
        await sendPermission("missing-approval"),
      ];
      const patched = daemon.missions.patch(mission.id, (current) => ({
        ...current,
        title: "Reviewed publishing metadata",
      }));
      daemon.missions.notify(mission.id, "info", "info", "Exact notice");
      const spec = {
        detail: { original: { ids: ["first", "second"] } },
        id: "architecture-operation",
        kind: "architecture.fixture",
        missionId: mission.id,
      };
      const first = await daemon.journal.run(spec, () =>
        Promise.resolve({ originalId: "native-request-1", receipt: "kept" })
      );
      const duplicate = await daemon.journal.run(
        {
          ...spec,
          detail: { retryPayload: "must not replace original intent" },
        },
        () => Promise.reject(new Error("A duplicate must not run the effect"))
      );
      expect({
        duplicate,
        first,
        grants: daemon.store.listGrants(),
        patched,
        pending: daemon.missions.broker.pending(mission.id),
        permission: daemon.store.permissions.get("historical-approval"),
        receipt: daemon.journal.get(spec.id),
        responses,
        seen,
        snapshot: daemon.missions.snapshot(mission.id),
      }).toMatchSnapshot("eafc235 HTTP, events and durable receipts");
      unsubscribe();
    } finally {
      unsubscribe();
      await daemon.close();
    }

    const copy = `${config.dbPath}.reopen`;
    await copyFile(config.dbPath, copy);
    const handle = openDatabase(copy);
    try {
      const store = new Store(handle);
      const log = new EventLog(store, { now });
      const journal = new OperationJournal(store, log, now);
      expect({
        mission: store.getMission(mission.id),
        receipt: journal.replay({
          id: "architecture-operation",
          kind: "architecture.fixture",
          missionId: mission.id,
        }),
        replay: log.replay(mission.id, 0),
      }).toMatchSnapshot("eafc235 reopened public documents and replay");
      if (process.env.ARCHITECTURE_EXPORT_DB) {
        await handle.sqlite.backup(process.env.ARCHITECTURE_EXPORT_DB);
      }
    } finally {
      handle.close();
    }
  });
});
