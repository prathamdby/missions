import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, expectTypeOf, it } from "vitest";

import type { MissionService } from "../missions/mission-service";
import type { GitServiceOptions } from "./git-service";
import type { PublishMissionAccess } from "./mission-access";

const broadDependency = (source: string) =>
  /from ["']\.\.\/missions\/mission-service["']/u.test(source);

describe("publishing mission boundary", () => {
  it("rejects the broad dependency and permits the publishing interface", () => {
    expect(
      broadDependency(
        'import type { MissionService } from "../missions/mission-service";'
      )
    ).toBeTruthy();
    expect(
      broadDependency(
        'import type { PublishMissionAccess } from "./mission-access";'
      )
    ).toBeFalsy();
  });

  it("gives GitService only the five existing publishing methods", async () => {
    const source = await readFile(
      path.join(import.meta.dirname, "git-service.ts"),
      "utf-8"
    );
    expect(broadDependency(source)).toBeFalsy();
    expectTypeOf<
      GitServiceOptions["missions"]
    >().toEqualTypeOf<PublishMissionAccess>();
    expectTypeOf<PublishMissionAccess>().toEqualTypeOf<
      Pick<
        MissionService,
        | "get"
        | "patch"
        | "notify"
        | "withWorkspaceMutation"
        | "withWorkspaceRecovery"
      >
    >();
    expectTypeOf<keyof PublishMissionAccess>().toEqualTypeOf<
      | "get"
      | "patch"
      | "notify"
      | "withWorkspaceMutation"
      | "withWorkspaceRecovery"
    >();
  });
});
