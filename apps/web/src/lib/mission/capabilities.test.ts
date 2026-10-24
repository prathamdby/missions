import { MissionStatusSchema } from "@missions/protocol/missions";
import type { PermissionRequest } from "@missions/protocol/missions";
import { describe, expect, it } from "vitest";

import { canPause, canResume, isMissionActive } from "../format";
import { missionCapabilities } from "./capabilities";
import { canArchive } from "./finish";
import { permissionDecisions } from "./permissions";

describe("Mission capabilities", () => {
  it("keeps header, banners, composer, and finish policy consistent for every daemon status", () => {
    for (const status of MissionStatusSchema.options) {
      const capabilities = missionCapabilities(status);
      expect([
        canPause(status),
        canResume(status),
        isMissionActive(status),
        canArchive(status),
        capabilities.publish,
      ]).toStrictEqual([
        capabilities.pause,
        capabilities.resume,
        capabilities.active,
        capabilities.archive,
        capabilities.archive,
      ]);
    }
    expect(missionCapabilities("failed")).toMatchObject({
      message: false,
      resume: true,
    });
    expect(missionCapabilities("completed")).toMatchObject({
      active: false,
      message: false,
      pause: false,
      publish: true,
      resume: false,
    });
    expect(missionCapabilities("awaiting_approval")).toMatchObject({
      message: true,
      pause: true,
      publish: false,
    });
    expect(
      MissionStatusSchema.options.filter(
        (status) => missionCapabilities(status).delete
      )
    ).toStrictEqual([
      "paused",
      "interrupted",
      "completed",
      "failed",
      "archived",
    ]);
    expect(missionCapabilities("archived")).toMatchObject({
      archive: false,
      message: false,
      pause: false,
      resume: false,
      update: false,
    });
  });

  it("offers persistent tool grants but never persistent publish consent or decisions on a resolved gate", () => {
    const request: PermissionRequest = {
      agentId: null,
      allowAlways: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      decidedAt: null,
      decision: null,
      epoch: 1,
      id: "r",
      kind: "tool",
      missionId: "m",
      reason: null,
      status: "pending",
      toolUses: [],
    };
    expect(permissionDecisions(request)).toStrictEqual([
      "approve_once",
      "always_allow",
      "deny",
    ]);
    expect(permissionDecisions({ ...request, kind: "publish" })).toStrictEqual([
      "approve_once",
      "deny",
    ]);
    expect(
      permissionDecisions({ ...request, allowAlways: false })
    ).toStrictEqual(["approve_once", "deny"]);
    expect(
      permissionDecisions({ ...request, status: "approved" })
    ).toStrictEqual([]);
  });
});
