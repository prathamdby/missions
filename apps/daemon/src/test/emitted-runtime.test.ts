import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const FILES = [
  "apps/daemon/src/missions/mission-service.ts",
  "apps/daemon/src/sdk/agent-runtime.ts",
  "apps/daemon/src/test/fake-runtime.ts",
  "apps/daemon/src/test/scripted-runtime.ts",
  "apps/daemon/src/daemon.ts",
  "apps/daemon/src/git/git-service.ts",
  "apps/daemon/src/sdk/prompts.ts",
  "apps/daemon/src/sdk/role-tools.ts",
  "apps/daemon/src/sdk/native-queue.ts",
  "apps/daemon/src/db/store.ts",
  "apps/daemon/src/db/normalize.ts",
  "apps/daemon/src/db/journal.ts",
];

describe("type-only executable equivalence", () => {
  it("preserves executable code across type-only boundary changes", async () => {
    const emitted = await Promise.all(
      FILES.map(async (file) => {
        const source = await readFile(path.join(ROOT, file), "utf-8");
        return [
          file,
          createHash("sha256")
            .update(stripTypeScriptTypes(source, { mode: "transform" }))
            .digest("hex"),
        ];
      })
    );
    expect(Object.fromEntries(emitted)).toMatchSnapshot(
      "eafc235 executable modules"
    );
  });
});
