import { MissionSchema } from "@missions/protocol/missions";
import { routes } from "@missions/protocol/routes";
import { describe, expect, expectTypeOf, it } from "vitest";

import { createDaemon } from "../daemon";
import { testConfig } from "../test/fixtures";
import { bootDaemon, control, startMission } from "../test/mission-harness";
import { PermissionBroker, StaleDecisionError } from "./permission-broker";

const AT = "2026-10-25T12:00:00.000Z";
const mission = MissionSchema.parse({
  createdAt: AT,
  endedAt: null,
  epoch: 2,
  executionMode: "work",
  goal: "Historical permission compatibility",
  id: "permission-mission",
  lastError: null,
  orchestrator: { modelId: "fixture", reasoningEffort: null },
  projectId: "permission-project",
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
  title: "Historical permissions",
  updatedAt: AT,
  worker: { modelId: "fixture", reasoningEffort: null },
  workspace: null,
});

const verifyHistory = async (
  daemon: Awaited<ReturnType<typeof createDaemon>>,
  port: number
) => {
  const before = daemon.missions.snapshot(mission.id);
  const events = daemon.log.replay(mission.id, 0);
  await Promise.all(
    (["approve_once", "always_allow", "deny"] as const).map(
      async (decision) => {
        await Promise.all(
          [
            [
              mission.id,
              "historical",
              409,
              "stale_revision",
              "This approval is no longer pending",
            ],
            [
              "other-mission",
              "historical",
              404,
              "not_found",
              "Approval not found",
            ],
            [mission.id, "missing", 404, "not_found", "Approval not found"],
          ].map(async ([missionId, requestId, status, code, message]) => {
            const response = await daemon.app.request(
              routes.permission(String(missionId), String(requestId)),
              {
                body: JSON.stringify({ decision, epoch: 2 }),
                headers: {
                  authorization: `Bearer ${daemon.token}`,
                  "content-type": "application/json",
                  host: `127.0.0.1:${port}`,
                },
                method: "POST",
              }
            );
            expect(response.status).toBe(status);
            await expect(response.json()).resolves.toStrictEqual({
              error: { code, message },
            });
          })
        );
      }
    )
  );
  expect(daemon.missions.snapshot(mission.id)).toStrictEqual(before);
  expect(daemon.log.replay(mission.id, 0)).toStrictEqual(events);
  expect(daemon.store.listGrants()).toStrictEqual([]);
  expect(daemon.missions.broker.pending(mission.id)).toStrictEqual([]);
};

describe("permission compatibility", () => {
  it("never revives stored pending approvals during owner invalidation or deletion", async () => {
    const booted = await bootDaemon([]);
    const { daemon } = booted;
    try {
      const started = await startMission(booted);
      const current = daemon.missions.get(started.missionId);
      const request = {
        agentId: started.orchestrator.options.agentId,
        allowAlways: true,
        createdAt: AT,
        decidedAt: null,
        decision: null,
        epoch: current.epoch,
        id: "pending-before-pause",
        kind: "tool" as const,
        missionId: current.id,
        reason: null,
        status: "pending" as const,
        toolUses: [],
      };
      daemon.store.permissions.put(request);
      expect(daemon.missions.broker.pending(current.id)).toStrictEqual([]);

      await daemon.missions.pause(
        current.id,
        control(daemon, current.id, "invalidate-pending-owner")
      );
      expect({
        closed: started.orchestrator.closed,
        grants: daemon.store.listGrants(),
        pending: daemon.missions.broker.pending(current.id),
        stored: daemon.store.permissions.get(request.id),
      }).toStrictEqual({
        closed: true,
        grants: [],
        pending: [],
        stored: { ...request, rewindDiscarded: false },
      });
      expect(() =>
        daemon.missions.decidePermission(current.id, request.id, {
          decision: "always_allow",
          epoch: current.epoch,
        })
      ).toThrow("This approval is no longer pending");

      await expect(
        daemon.missions.remove(
          current.id,
          control(daemon, current.id, "delete-stored-pending")
        )
      ).resolves.toMatchObject({
        operationId: "delete-stored-pending",
        status: "accepted",
      });
      expect({
        grants: daemon.store.listGrants(),
        mission: daemon.store.getMission(current.id),
        pending: daemon.missions.broker.pending(current.id),
        stored: daemon.store.permissions.get(request.id),
      }).toStrictEqual({
        grants: [],
        mission: null,
        pending: [],
        stored: null,
      });
    } finally {
      await daemon.close();
    }
  });

  it("keeps historical, missing and wrong-mission HTTP errors through restart", async () => {
    const config = await testConfig();
    const options = {
      config,
      loadModels: () => Promise.resolve([]),
      version: "permission-compatibility",
    };
    const daemon = await createDaemon(options);
    try {
      daemon.store.putMission(mission);
      daemon.store.putMission({ ...mission, id: "other-mission" });
      daemon.store.permissions.put({
        agentId: null,
        allowAlways: true,
        createdAt: AT,
        decidedAt: null,
        decision: null,
        epoch: 2,
        id: "historical",
        kind: "tool",
        missionId: mission.id,
        reason: null,
        status: "pending",
        toolUses: [],
      });
      await verifyHistory(daemon, config.port);
    } finally {
      await daemon.close();
    }
    const reopened = await createDaemon(options);
    try {
      await verifyHistory(reopened, config.port);
      expect(reopened.store.permissions.get("historical")?.status).toBe(
        "stale"
      );
    } finally {
      await reopened.close();
    }
  });

  it("keeps the synchronous StaleDecisionError and never calls completion storage", () => {
    expectTypeOf<Pick<PermissionBroker, "pending" | "decide">>().toEqualTypeOf<{
      pending: PermissionBroker["pending"];
      decide: PermissionBroker["decide"];
    }>();
    const broker = new PermissionBroker({
      acquireWriteLease: () => Promise.resolve(),
      context: () => {
        throw new Error("A stale decision must not read agent context");
      },
      roleToolServer: "missions",
      store: {
        addGrant: () => {
          throw new Error("Unexpected grant");
        },
        listGrants: () => {
          throw new Error("Unexpected grant read");
        },
        saveRequest: () => {
          throw new Error("Unexpected permission write");
        },
      },
    });
    expect(broker.pending("missing")).toStrictEqual([]);
    for (const decision of ["approve_once", "always_allow", "deny"] as const) {
      expect(() => broker.decide("historical", decision, 999)).toThrow(
        new StaleDecisionError("This approval is no longer pending")
      );
    }
    broker.cancelMission("missing");
  });
});
