import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const exposesBinding = (consumer: string, source: string) =>
  consumer === "mission-view.tsx" &&
  /from ["'](?:@\/lib\/mission\/|\.\/)command-registry["']/u.test(source);

const exposesTimeline = (consumer: string, source: string) =>
  consumer === "chat-column.tsx" &&
  /from ["'](?:@\/lib\/mission\/|\.\/)timeline["']/u.test(source);

const couplesProjection = (source: string) =>
  /from ["'](?:react(?:\/[^"']*)?|node:[^"']*|@factory\/[^"']*|[^"']*(?:components\/|daemon\/|command-registry|mission-store)[^"']*)["']/u.test(
    source
  );

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

  it("keeps timeline assembly in the pure projection, not ChatColumn", async () => {
    const assembly =
      'import { buildTimeline, turnParts } from "@/lib/mission/timeline";';
    expect(exposesTimeline("chat-column.tsx", assembly)).toBeTruthy();
    expect(exposesTimeline("conversation.ts", assembly)).toBeFalsy();
    expect(
      exposesTimeline(
        "chat-column.tsx",
        'import { conversationParts } from "@/lib/mission/conversation";'
      )
    ).toBeFalsy();
    const source = await readFile(
      path.join(
        import.meta.dirname,
        "../../components/mission/chat-column.tsx"
      ),
      "utf-8"
    );
    expect(exposesTimeline("chat-column.tsx", source)).toBeFalsy();
  });

  it("keeps projection free of rendering, owners, SDK and I/O dependencies", async () => {
    for (const dependency of [
      "react",
      "node:fs",
      "@factory/droid-sdk",
      "@/components/mission/transcript",
      "apps/daemon/src/daemon",
      "./command-registry",
      "../live/mission-store",
    ]) {
      expect(
        couplesProjection(`import { value } from "${dependency}";`)
      ).toBeTruthy();
    }
    for (const dependency of [
      "./timeline",
      "../live/mission-state",
      "@missions/protocol/missions",
    ]) {
      expect(
        couplesProjection(`import type { Value } from "${dependency}";`)
      ).toBeFalsy();
    }
    const source = await readFile(
      path.join(import.meta.dirname, "conversation.ts"),
      "utf-8"
    );
    expect(couplesProjection(source)).toBeFalsy();
  });
});
