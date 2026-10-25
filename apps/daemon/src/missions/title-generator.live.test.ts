import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ModelCatalog } from "../settings/models";
import { TitleGenerator } from "./title-generator";

const WORDS = /\s+/u;

describe("live Auto titles", () => {
  it(
    "names the change in 2–6 sentence-case words",
    { timeout: 30_000 },
    async () => {
      const droidPath =
        process.env.MISSIONS_DROID_PATH ??
        path.join(os.homedir(), ".local/bin/droid");
      const models = new ModelCatalog(droidPath);
      const generator = new TitleGenerator({ droidPath, models });
      try {
        const title = await generator.generate({
          goal: "Fix keyboard focus rings on read-only panels and make message text selectable",
          projectName: "Missions",
        });
        expect(title).not.toBeNull();
        expect(title?.split(WORDS).length).toBeGreaterThanOrEqual(2);
        expect(title?.split(WORDS).length).toBeLessThanOrEqual(6);
        expect(title).toMatch(/^[A-Z]/u);
      } finally {
        await generator.close();
        await models.close();
      }
    }
  );
});
