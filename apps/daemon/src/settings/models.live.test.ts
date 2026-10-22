import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ModelCatalog } from "./models";

const DROID =
  process.env.MISSIONS_DROID_PATH ??
  path.join(os.homedir(), ".local/bin/droid");

describe("live model catalog", () => {
  it(
    "lists models from the installed Droid CLI",
    { timeout: 60_000 },
    async () => {
      const list = await new ModelCatalog(DROID).list();
      expect(list.source).toBe("droid");
      expect(
        list.models.some(
          (model) =>
            model.id === (process.env.MISSIONS_LIVE_MODEL ?? "glm-5.3-flash")
        )
      ).toBeTruthy();
    }
  );
});
