import { routes } from "@missions/protocol/routes";
import { ModelListSchema } from "@missions/protocol/settings";
import { afterEach, describe, expect, it } from "vitest";

import { createDaemon } from "../daemon";
import type { Daemon } from "../daemon";
import { testConfig } from "../test/fixtures";
import { ModelCatalog } from "./models";

const RAW = [
  {
    defaultReasoningEffort: "high",
    displayName: "GLM Flash",
    id: "glm-5.3-flash",
    supportedReasoningEfforts: ["low", "high", "bogus"],
  },
  { displayName: "No efforts", id: "plain" },
];

const opened: Daemon[] = [];

describe(ModelCatalog, () => {
  afterEach(async () => {
    await Promise.all(opened.splice(0).map((daemon) => daemon.close()));
  });

  it("maps CLI models and drops unknown reasoning efforts", async () => {
    const list = await new ModelCatalog("droid", () =>
      Promise.resolve(RAW)
    ).list();
    expect(list).toStrictEqual({
      models: [
        {
          defaultReasoningEffort: "high",
          displayName: "GLM Flash",
          id: "glm-5.3-flash",
          supportedReasoningEfforts: ["low", "high"],
        },
        {
          defaultReasoningEffort: null,
          displayName: "No efforts",
          id: "plain",
          supportedReasoningEfforts: [],
        },
      ],
      source: "droid",
    });
  });

  it("reports unavailability instead of failing", async () => {
    const catalog = new ModelCatalog("droid", () =>
      Promise.reject(new Error("no droid"))
    );
    await expect(catalog.list()).resolves.toStrictEqual({
      models: [],
      source: "unavailable",
    });
    await expect(
      catalog.validate({ modelId: "anything", reasoningEffort: null }, "Worker")
    ).resolves.toBeUndefined();
  });

  it("rejects unsupported models and efforts in settings", async () => {
    const daemon = await createDaemon({
      config: await testConfig(),
      loadModels: () => Promise.resolve(RAW),
      version: "test",
    });
    opened.push(daemon);
    const headers = {
      authorization: `Bearer ${daemon.token}`,
      "content-type": "application/json",
      host: "127.0.0.1:4317",
    };
    const patch = (worker: unknown) =>
      daemon.app.request(routes.settings(), {
        body: JSON.stringify({ worker }),
        headers,
        method: "PATCH",
      });
    const statuses = await Promise.all([
      patch({ modelId: "missing", reasoningEffort: null }),
      patch({ modelId: "glm-5.3-flash", reasoningEffort: "max" }),
      patch({ modelId: "glm-5.3-flash", reasoningEffort: "low" }),
    ]);
    expect(statuses.map((res) => res.status)).toStrictEqual([400, 400, 200]);
    const res = await daemon.app.request(routes.models(), { headers });
    const models = ModelListSchema.parse(await res.json());
    expect(models.models.map((model) => model.id)).toStrictEqual([
      "glm-5.3-flash",
      "plain",
    ]);
  });
});
