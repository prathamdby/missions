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
    epoch: 1,
    fenced: false,
    missionId: "m1",
    planMode: false,
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
  it.each([
    ["git -C '/repo with spaces' push origin main", "publish"],
    ["git -c core.quotePath=false -C /w commit -m x", "vcs"],
    ["git --git-dir=/w/.git --work-tree /w reset --hard", "vcs"],
    ["git -C/w -ccore.quotePath=false status", "execute"],
    ["git --unsupported-option status", "publish"],
    ["git -c alias.ship='!git push' ship", "publish"],
    ["gh --repo owner/repo pr create --fill", "publish"],
    ["gh -Rowner/repo pr merge", "publish"],
    ["gh --hostname github.example api /repos/a/b -X DELETE", "publish"],
    ["gh api /repos/a/b -f name=value", "publish"],
    ["gh api /repos/a/b --field=name=value", "publish"],
    ["gh api /repos/a/b --method=PATCH", "publish"],
    ["gh api /repos/a/b --method GET", "execute"],
    ["gh -R owner/repo pr view 3", "execute"],
    ["git status && git -C /w push", "publish"],
    ["sh -c 'git -C /w push'", "publish"],
    ['bash -c "git -c core.quotePath=false commit -m x"', "vcs"],
    ["gh --unknown-global foo pr list", "publish"],
  ])("classifies %s as %s", (command, category) => {
    expect(classifyToolUse(exec(command), "/w", "missions").category).toBe(
      category
    );
  });

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

  it("auto-approves commands at every impact level", () => {
    const low = classifyToolUse(exec("ls", "low"), "/w", "missions");
    const high = classifyToolUse(
      exec("rm -rf build", "high"),
      "/w",
      "missions"
    );
    expect(autoApproves(low)).toBeTruthy();
    expect(autoApproves(high)).toBeTruthy();
  });
});

describe(PermissionBroker, () => {
  it("keeps exact command identity for quoted whitespace and excludes legacy keys", () => {
    const first = classifyToolUse(
      exec('printf "%s" "two  spaces"'),
      "/w",
      "missions"
    );
    const second = classifyToolUse(
      exec('printf "%s" "two spaces"'),
      "/w",
      "missions"
    );
    expect(first.normalized).toBe('exec:v2:printf "%s" "two  spaces"');
    expect(second.normalized).toBe('exec:v2:printf "%s" "two spaces"');
    expect(first.normalized).not.toBe(second.normalized);
  });

  it("rejects execution-capable tools on read-only assignments before grants and policy", async () => {
    const { broker, grants, leases } = setup({ canWrite: false });
    const command = exec("echo hi", "low");
    grants.push({
      action: "Execute",
      createdAt: "2026-01-01T00:00:00.000Z",
      id: "read-only-grant",
      normalizedRequest: "exec:v2:echo hi",
      projectId: "p1",
      role: "worker",
      workspacePath: "/w",
    });
    const executionCapableUses = [
      command,
      create("/w/x"),
      {
        confirmationType: "mcp_tool",
        details: {
          actualToolName: "execute",
          impactLevel: "low",
          serverName: "external",
          type: "mcp_tool",
        },
        input: {},
        toolName: "external",
        toolUseId: "mcp",
      },
    ];
    await Promise.all(
      executionCapableUses.map(async (use) => {
        await expect(broker.ask("a", [use])).resolves.toMatchObject({
          approved: false,
          reason: "This assignment is read-only",
        });
      })
    );
    await expect(
      broker.ask("a", [
        {
          confirmationType: "read",
          details: {},
          input: {},
          toolName: "Read",
          toolUseId: "read",
        },
      ])
    ).resolves.toMatchObject({ approved: true });
    expect(leases).toHaveLength(0);
  });

  it("rechecks current Plan mode and capabilities after a pending approval", async () => {
    const { broker, ctx, lastPending } = setup();
    const pending = broker.ask("a", [create("/outside/x")]);
    ctx.canWrite = false;
    expect(() =>
      broker.decide(lastPending()?.id ?? "", "always_allow", 1)
    ).toThrow(/earlier run/u);
    await expect(pending).resolves.toMatchObject({ approved: false });
    ctx.canWrite = true;
    const second = broker.ask("a", [create("/outside/x")]);
    ctx.planMode = true;
    expect(() =>
      broker.decide(lastPending()?.id ?? "", "approve_once", 1)
    ).toThrow(/earlier run/u);
    await expect(second).resolves.toMatchObject({ approved: false });
  });

  it.each(["orchestrator", "worker"] as const)(
    "Plan mode keeps the %s read-only before automatic approval",
    async (role) => {
      const { broker } = setup({ planMode: true, role });
      await expect(broker.ask("a", [create("/w/x")])).resolves.toMatchObject({
        approved: false,
        reason: expect.stringContaining("Plan mode"),
      });
      await expect(broker.ask("a", [exec("ls", "low")])).resolves.toMatchObject(
        {
          approved: true,
        }
      );
    }
  );

  it.each([
    "git commit -m x",
    "git push",
    "gh pr create --fill",
    "git reset --hard",
  ])("auto-approves main-agent %s by policy", async (command) => {
    const { broker } = setup({ role: "orchestrator" });
    await expect(broker.ask("a", [exec(command)])).resolves.toStrictEqual({
      approved: true,
      via: "policy",
    });
  });

  it("Pause denies otherwise auto-approved edits and publishing", async () => {
    const { broker, requests, leases } = setup({
      fenced: true,
      role: "orchestrator",
    });
    await Promise.all(
      [create("/w/x"), exec("git push"), exec("git reset --hard")].map(
        async (use) => {
          await expect(broker.ask("a", [use])).resolves.toStrictEqual({
            approved: false,
            reason: "Mission is paused",
          });
        }
      )
    );
    expect(requests).toHaveLength(0);
    expect(leases).toHaveLength(0);
  });

  it("never lets a Worker run Git administration", async () => {
    const { broker } = setup({ role: "worker" });
    await Promise.all(
      ["git commit -m x", "git push", "git switch -c x"].map(
        async (command) => {
          await expect(broker.ask("a", [exec(command)])).resolves.toMatchObject(
            {
              approved: false,
              reason: expect.stringContaining("main agent"),
            }
          );
        }
      )
    );
  });

  it("treats branch changes and destructive Git as high impact", () => {
    for (const command of [
      "git reset --hard",
      "git clean -fd",
      "git switch main",
      "git checkout -b feature",
      "git branch -D old",
      "git rebase main",
      "git stash",
    ]) {
      const use = classifyToolUse(exec(command), "/w", "missions");
      expect({ command, impact: use.impact }).toStrictEqual({
        command,
        impact: "high",
      });
      expect(autoApproves(use)).toBeTruthy();
    }
    expect(
      classifyToolUse(exec("git commit -m x"), "/w", "missions").impact
    ).not.toBe("high");
  });

  it("blocks repository administration while another agent is writing", async () => {
    const { broker } = setup({
      otherWriters: ["Worker 2"],
      role: "orchestrator",
    });
    await expect(broker.ask("a", [exec("git push")])).resolves.toMatchObject({
      approved: false,
      reason: expect.stringContaining("Worker 2"),
    });
    await expect(
      broker.ask("a", [exec("git reset --hard")])
    ).resolves.toMatchObject({ approved: false });
    await expect(
      broker.ask("a", [exec("git commit -m x")])
    ).resolves.toMatchObject({ approved: true });
  });

  it("stores scoped Always allow grants that later auto-approve", async () => {
    const { broker, grants, lastPending } = setup();
    const first = broker.ask("a", [create("/outside/a.ts")]);
    expect(broker.pending("m1")).toMatchObject([
      { allowAlways: true, kind: "tool", status: "pending" },
    ]);
    await Promise.resolve();
    broker.decide(lastPending()?.id ?? "", "always_allow", 1);
    await expect(first).resolves.toMatchObject({ approved: true });
    expect(lastPending()).toMatchObject({ allowAlways: true, kind: "tool" });
    expect(grants[0]).toMatchObject({
      action: "Create",
      normalizedRequest: "/outside/a.ts",
      projectId: "p1",
      role: "worker",
      workspacePath: "/w",
    });
    await expect(
      broker.ask("a", [create("/outside/a.ts")])
    ).resolves.toMatchObject({
      approved: true,
      via: "grant",
    });
  });

  it("rejects stale decisions and cancels waiters on Pause", async () => {
    const { broker, ctx, lastPending } = setup();
    const pending = broker.ask("a", [create("/outside/a.ts")]);
    await Promise.resolve();
    const id = lastPending()?.id ?? "";
    expect(() => broker.decide(id, "approve_once", 0)).toThrow(/earlier run/u);
    await expect(pending).resolves.toMatchObject({ approved: false });

    const second = broker.ask("a", [create("/outside/b.ts")]);
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
    const { broker, leases } = setup();
    await broker.ask("a", [exec("ls", "low")]);
    expect(leases).toHaveLength(0);
    await broker.ask("a", [create("/w/a.ts")]);
    expect(leases).toStrictEqual(["a"]);
  });
});
