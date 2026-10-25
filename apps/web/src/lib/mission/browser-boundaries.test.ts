import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const exposesBinding = (consumer: string, source: string) =>
  consumer === "mission-view.tsx" &&
  /from ["'](?:@\/lib\/mission\/|\.\/)command-registry["']/u.test(source);

describe("mission browser boundaries", () => {
  it("rejects view-owned binding but permits its hook and sidebar admission", () => {
    const assembly =
      'import { missionCommandsFor } from "@/lib/mission/command-registry";';
    expect(exposesBinding("mission-view.tsx", assembly)).toBeTruthy();
    expect(exposesBinding("use-mission-commands.ts", assembly)).toBeFalsy();
    expect(exposesBinding("mission-menu.tsx", assembly)).toBeFalsy();
    expect(
      exposesBinding(
        "mission-view.tsx",
        'import { useMissionCommands } from "@/lib/mission/use-mission-commands";'
      )
    ).toBeFalsy();
  });

  it("keeps command registry assembly out of MissionView", async () => {
    const source = await readFile(
      path.join(
        import.meta.dirname,
        "../../components/mission/mission-view.tsx"
      ),
      "utf-8"
    );
    expect(exposesBinding("mission-view.tsx", source)).toBeFalsy();
  });
});
