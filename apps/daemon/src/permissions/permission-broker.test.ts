import type { Grant, PermissionRequest } from "@missions/protocol/missions";
import { describe, expect, it } from "vitest";

import type { PermissionToolUse } from "../sdk/agent-runtime";
import {
  autoApproves,
  classifyToolUse,
  PermissionBroker,
} from "./permission-broker";
import type { AgentContext } from "./permission-broker";

const exec = (command: string, impactLevel = "medium"): PermissionToolUse => ({
  confirmationType: "exec",
  details: { command, fullCommand: command, impactLevel, type: "exec" },
  input: { command },
  toolName: "Execute",
  toolUseId: "t1",
});
const create = (filePath: string): PermissionToolUse => ({
  confirmationType: "create",
  details: { content: "hi", fileName: "a", filePath, type: "create" },
  input: {},
  toolName: "Create",
  toolUseId: "t2",
});

const setup = (overrides: Partial<AgentContext> = {}) => {
  const ctx: AgentContext = {
    autonomy: "medium",
    epoch: 1,
    fenced: false,
    missionId: "m1",
    planApproved: true,
    projectId: "p1",
    role: "worker",
    workspacePath: "/w",
    ...overrides,
  };
  const requests: PermissionRequest[] = [];
  const grants: Grant[] = [];
  const leases: string[] = [];
  const broker = new PermissionBroker({
    acquireWriteLease: (agentId) => {
      leases.push(agentId);
      return Promise.resolve();
    },
    context: () => ctx,
    roleToolServer: "missions",
    store: {
      addGrant: (grant) => grants.push(grant),
      listGrants: () => grants,
      saveRequest: (request) => requests.push(request),
    },
  });
  const lastPending = () => requests.findLast((r) => r.status === "pending");
  return { broker, ctx, grants, lastPending, leases, requests };
};

describe(classifyToolUse, () => {
  it("detects publishing and history-changing git commands", () => {
    expect(
      classifyToolUse(exec("git push origin main"), "/w", "missions").category
    ).toBe("publish");
    expect(
      classifyToolUse(exec("gh pr create --fill"), "/w", "missions").category
    ).toBe("publish");
    expect(
      classifyToolUse(exec("git commit -m x"), "/w", "missions").category
    ).toBe("vcs");
    expect(
      classifyToolUse(exec("git status", "low"), "/w", "missions").category
    ).toBe("execute");
  });

  it("marks edits outside the workspace as high impact", () => {
    expect(
      classifyToolUse(create("/w/src/a.ts"), "/w", "missions")
    ).toMatchObject({
      category: "edit",
      impact: "medium",
      normalized: "src/a.ts",
    });
    expect(classifyToolUse(create("/etc/hosts"), "/w", "missions").impact).toBe(
      "high"
    );
  });

  it("maps autonomy levels to command impact", () => {
    const low = classifyToolUse(exec("ls", "low"), "/w", "missions");
    const high = classifyToolUse(
      exec("rm -rf build", "high"),
      "/w",
      "missions"
    );
    expect(autoApproves("off", low)).toBeFalsy();
    expect(autoApproves("low", low)).toBeTruthy();
    expect(autoApproves("medium", high)).toBeFalsy();
    expect(autoApproves("high", high)).toBeTruthy();
  });
});

describe(PermissionBroker, () => {
  it("blocks writes before plan approval even at High autonomy", async () => {
    const { broker } = setup({ autonomy: "high", planApproved: false });
    await expect(broker.ask("a", [create("/w/x")])).resolves.toMatchObject({
      approved: false,
    });
    await expect(broker.ask("a", [exec("ls", "low")])).resolves.toMatchObject({
      approved: true,
    });
  });

  it("always asks for publishing, without an Always allow option", async () => {
    const { broker, lastPending } = setup({ autonomy: "high" });
    const pending = broker.ask("a", [exec("git push")]);
    await Promise.resolve();
    const request = lastPending();
    expect(request).toMatchObject({ allowAlways: false, kind: "publish" });
    expect(() => broker.decide(request?.id ?? "", "always_allow", 1)).toThrow(
      /explicit/u
    );
    broker.decide(request?.id ?? "", "approve_once", 1);
    await expect(pending).resolves.toMatchObject({
      approved: true,
      via: "user",
    });
  });

  it("stores scoped Always allow grants that later auto-approve", async () => {
    const { broker, grants, lastPending } = setup({ autonomy: "off" });
    const first = broker.ask("a", [create("/w/a.ts")]);
    await Promise.resolve();
    broker.decide(lastPending()?.id ?? "", "always_allow", 1);
    await expect(first).resolves.toMatchObject({ approved: true });
    expect(grants[0]).toMatchObject({
      action: "Create",
      normalizedRequest: "a.ts",
      projectId: "p1",
      role: "worker",
      workspacePath: "/w",
    });
    await expect(broker.ask("a", [create("/w/a.ts")])).resolves.toMatchObject({
      approved: true,
      via: "grant",
    });
  });

  it("rejects stale decisions and cancels waiters on Pause", async () => {
    const { broker, ctx, lastPending } = setup({ autonomy: "off" });
    const pending = broker.ask("a", [create("/w/a.ts")]);
    await Promise.resolve();
    const id = lastPending()?.id ?? "";
    expect(() => broker.decide(id, "approve_once", 0)).toThrow(/earlier run/u);
    await expect(pending).resolves.toMatchObject({ approved: false });

    const second = broker.ask("a", [create("/w/b.ts")]);
    await Promise.resolve();
    ctx.fenced = true;
    broker.cancelMission("m1");
    await expect(second).resolves.toMatchObject({ approved: false });
    await expect(broker.ask("a", [exec("ls", "low")])).resolves.toMatchObject({
      approved: false,
      reason: "Mission is paused",
    });
  });

  it("takes the write lease only for writable actions", async () => {
    const { broker, leases } = setup({ autonomy: "high" });
    await broker.ask("a", [exec("ls", "low")]);
    expect(leases).toHaveLength(0);
    await broker.ask("a", [create("/w/a.ts")]);
    expect(leases).toStrictEqual(["a"]);
  });
});
