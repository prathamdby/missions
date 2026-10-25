import os from "node:os";
import path from "node:path";

import { routes } from "@missions/protocol/routes";
import { ModelListSchema } from "@missions/protocol/settings";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDaemon } from "../daemon";
import type { Daemon } from "../daemon";
import { MODEL_PROBE_TIMEOUT_MS } from "../sdk/startup";
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
    vi.useRealTimers();
    await Promise.all(opened.splice(0).map((daemon) => daemon.close()));
  });

  it("serves remembered runtime models without probing, even after the probe cache expires", async () => {
    vi.useFakeTimers();
    const load = vi.fn<() => Promise<unknown[]>>();
    const catalog = new ModelCatalog("droid", load);
    catalog.remember(RAW);
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    const list = await catalog.list();
    expect(list).toMatchObject({
      models: [{ id: "glm-5.3-flash" }, { id: "plain" }],
      source: "droid",
    });
    expect(load).not.toHaveBeenCalled();
    catalog.remember([{ id: "refreshed" }]);
    catalog.remember([]);
    catalog.remember([{ invalid: true }]);
    await expect(catalog.list()).resolves.toMatchObject({
      models: [{ id: "refreshed" }],
    });
    await catalog.close();
    await expect(catalog.list()).resolves.toStrictEqual({
      models: [],
      source: "unavailable",
    });
  });

  it.each(["resolve", "reject"])(
    "does not let a stale probe %s replace remembered runtime models",
    async (outcome) => {
      const pending = Promise.withResolvers<unknown[]>();
      const load = vi.fn<() => Promise<unknown[]>>(() => pending.promise);
      const catalog = new ModelCatalog("droid", load);
      const first = catalog.list();
      catalog.remember(RAW);
      if (outcome === "resolve") {
        pending.resolve([{ id: "stale" }]);
      } else {
        pending.reject(new Error("offline"));
      }
      await expect(first).resolves.toMatchObject({
        models: [{ id: "glm-5.3-flash" }, { id: "plain" }],
        source: "droid",
      });
      await catalog.list();
      expect(load).toHaveBeenCalledOnce();
      await catalog.close();
    }
  );

  it("bounds a hung discovery, clears its pending slot and permits a retry", async () => {
    vi.useFakeTimers();
    const load = vi
      .fn<() => Promise<unknown[]>>()
      .mockReturnValueOnce(Promise.withResolvers<unknown[]>().promise)
      .mockResolvedValue(RAW);
    const catalog = new ModelCatalog("droid", load);
    const first = catalog.list();
    const shared = catalog.list();
    await vi.advanceTimersByTimeAsync(MODEL_PROBE_TIMEOUT_MS);
    await expect(first).resolves.toStrictEqual({
      models: [],
      source: "unavailable",
    });
    await expect(shared).resolves.toStrictEqual({
      models: [],
      source: "unavailable",
    });
    await expect(catalog.list()).resolves.toMatchObject({ source: "droid" });
    expect(load).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("requires an available catalog for mission updates and rejects efforts on a model without any", async () => {
    const unavailable = new ModelCatalog("droid", () =>
      Promise.reject(new Error("offline"))
    );
    await expect(
      unavailable.resolve({ modelId: "x", reasoningEffort: null }, "Worker")
    ).rejects.toThrow(/discovery is unavailable/u);
    const catalog = new ModelCatalog("droid", () => Promise.resolve(RAW));
    await expect(
      catalog.resolve({ modelId: "plain", reasoningEffort: "high" }, "Worker")
    ).rejects.toThrow(/does not support/u);
    await expect(
      catalog.resolve(
        { modelId: "glm-5.3-flash", reasoningEffort: null },
        "Worker"
      )
    ).resolves.toStrictEqual({
      modelId: "glm-5.3-flash",
      reasoningEffort: "high",
    });
  });

  it("cancels a pending discovery deadline on shutdown instead of leaving a timer behind", async () => {
    vi.useFakeTimers();
    const catalog = new ModelCatalog(
      "droid",
      () => Promise.withResolvers<unknown[]>().promise
    );
    const pending = catalog.list();
    await catalog.close();
    await expect(pending).resolves.toStrictEqual({
      models: [],
      source: "unavailable",
    });
    await expect(catalog.list()).resolves.toStrictEqual({
      models: [],
      source: "unavailable",
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([null, "none"])(
    "resolves no-effort models with native default %s to protocol null",
    async (defaultReasoningEffort) => {
      const catalog = new ModelCatalog("droid", () =>
        Promise.resolve([
          {
            defaultReasoningEffort,
            id: "plain",
            supportedReasoningEfforts: [],
          },
        ])
      );
      await expect(
        catalog.resolve(
          { modelId: "plain", reasoningEffort: null },
          "Orchestrator"
        )
      ).resolves.toStrictEqual({ modelId: "plain", reasoningEffort: null });
      await expect(
        catalog.resolve(
          { modelId: "plain", reasoningEffort: "none" },
          "Orchestrator"
        )
      ).rejects.toThrow(/does not support/u);
    }
  );

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

  it("accepts only full, specific worktree folders", async () => {
    const daemon = await createDaemon({
      config: await testConfig(),
      loadModels: () => Promise.resolve(RAW),
      version: "test",
    });
    opened.push(daemon);
    const patch = (worktreeRoot: string) =>
      daemon.app.request(routes.settings(), {
        body: JSON.stringify({ worktreeRoot }),
        headers: {
          authorization: `Bearer ${daemon.token}`,
          "content-type": "application/json",
          host: "127.0.0.1:4317",
        },
        method: "PATCH",
      });
    const relative = await patch("relative/path");
    const root = await patch("/");
    const home = await patch("~/missions-worktrees");
    expect({
      saved: daemon.settings.get().worktreeRoot,
      statuses: [relative.status, root.status, home.status],
    }).toStrictEqual({
      saved: path.join(os.homedir(), "missions-worktrees"),
      statuses: [400, 400, 200],
    });
  });
});
