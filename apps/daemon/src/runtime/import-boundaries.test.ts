import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const IMPORT_SOURCE = /(?:from\s+|import\s*)["'](?<source>[^"']+)["']/gu;
const orchestrationImports = (source: string) =>
  [...source.matchAll(IMPORT_SOURCE)]
    .map((match) => match.groups?.source ?? "")
    .filter((specifier) => specifier.endsWith("/missions/mission-service"));

describe("runtime dependency direction", () => {
  it("rejects an orchestration dependency and permits shared contracts", () => {
    expect(
      orchestrationImports(
        'import type { RuntimeHandle } from "../missions/mission-service";'
      )
    ).toStrictEqual(["../missions/mission-service"]);
    expect(
      orchestrationImports(
        'import type { RuntimeHandle } from "../runtime/contracts";'
      )
    ).toStrictEqual([]);
    expect(
      orchestrationImports(
        'import { isSystemRequest } from "../missions/messages";'
      )
    ).toStrictEqual([]);
  });

  it("keeps concrete runtime adapters independent of mission orchestration", async () => {
    const files = [
      "../test/fake-runtime.ts",
      "../test/scripted-runtime.ts",
      "../sdk/agent-runtime.ts",
      "./contracts.ts",
    ];
    const imports = await Promise.all(
      files.map(async (file) => ({
        file,
        forbidden: orchestrationImports(
          await readFile(path.join(import.meta.dirname, file), "utf-8")
        ),
      }))
    );
    expect(imports.filter((entry) => entry.forbidden.length > 0)).toStrictEqual(
      []
    );
  });
});
