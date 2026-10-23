import { mkdir, rmdir, symlink } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { tempDir } from "../test/fixtures";
import { WorkspaceOperationGate } from "./workspace-operation-gate";

describe(WorkspaceOperationGate, () => {
  it("excludes aliases of the same workspace while independent workspaces proceed", async () => {
    const root = await tempDir("workspace-gate");
    const workspace = path.join(root, "workspace");
    const alias = path.join(root, "alias");
    const other = path.join(root, "other");
    await Promise.all([mkdir(workspace), mkdir(other)]);
    await symlink(workspace, alias);
    const gate = new WorkspaceOperationGate();
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const order: string[] = [];
    const first = gate.run(workspace, async () => {
      entered.resolve(undefined);
      await release.promise;
      order.push("released");
    });
    await entered.promise;
    const second = gate.run(alias, () => order.push("alias"));
    await gate.run(other, () => order.push("independent"));
    expect(order).toStrictEqual(["independent"]);
    release.resolve(undefined);
    await Promise.all([first, second]);
    expect(order).toStrictEqual(["independent", "released", "alias"]);
  });

  it("releases exclusion after failed mutations", async () => {
    const workspace = await tempDir("workspace-gate");
    const gate = new WorkspaceOperationGate();
    await expect(
      gate.run(workspace, () => {
        throw new Error("failed mutation");
      })
    ).rejects.toThrow("failed mutation");
    await expect(gate.run(workspace, () => "admitted")).resolves.toBe(
      "admitted"
    );
  });

  it("recovers a removed canonical path without weakening normal mutation", async () => {
    const workspace = await tempDir("removed-workspace-gate");
    await rmdir(workspace);
    const gate = new WorkspaceOperationGate();
    await expect(
      gate.run(workspace, () => "new mutation")
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      gate.runRecovery(workspace, (canonical) => canonical)
    ).resolves.toBe(workspace);
    await expect(
      gate.runRecovery("relative/binding", () => "invalid")
    ).rejects.toThrow(/absolute canonical binding/u);
  });

  it("shares exclusion between missing-path recovery and normal admission after recreation", async () => {
    const workspace = await tempDir("recreated-workspace-gate");
    await rmdir(workspace);
    const gate = new WorkspaceOperationGate();
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const order: string[] = [];
    const recovery = gate.runRecovery(workspace, async () => {
      entered.resolve(undefined);
      await release.promise;
      order.push("reconciled");
    });
    await entered.promise;
    await mkdir(workspace);
    const admission = gate.run(workspace, () => order.push("admitted"));
    release.resolve(undefined);
    await Promise.all([recovery, admission]);
    expect(order).toStrictEqual(["reconciled", "admitted"]);
  });
});
