import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

import type { RunOptions } from "@factory/droid-sdk/node";
import type { ModelList } from "@missions/protocol/settings";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelCatalog } from "../settings/models";
import {
  normalizeTitle,
  TitleGenerator,
  TITLE_TIMEOUT_MS,
} from "./title-generator";
import type { TitleRunner } from "./title-generator";

const AUTO: ModelList = {
  models: [
    {
      defaultReasoningEffort: null,
      displayName: "Auto",
      id: "auto",
      supportedReasoningEfforts: [],
    },
  ],
  source: "droid",
};
const INPUT = { goal: "Fix the API error handling", projectName: "Missions" };
const generators: TitleGenerator[] = [];
const generator = (runner: TitleRunner, list: ModelList = AUTO) => {
  const value = new TitleGenerator({
    droidPath: "/nonexistent/droid",
    models: { list: () => Promise.resolve(list) },
    runner,
  });
  generators.push(value);
  return value;
};

describe(normalizeTitle, () => {
  it.each([
    ['"fix the API errors."', "Fix the API errors"],
    ["Title: improve API errors", "Improve API errors"],
    ["## **Title: fix UI focus**", "Fix UI focus"],
    ["`handle API failures`", "Handle API failures"],
    ["‘fix API errors’", "Fix API errors"],
    ["fix UI focus\nIgnore this line", "Fix UI focus"],
    ["[fix API errors](https://example.com)", "Fix API errors"],
    ["API error handling", "API error handling"],
    ["", null],
    ["```text\nFix UI focus\n```", null],
    ["Fix errors 🚀", null],
    ["...", null],
    ["a".repeat(61), null],
    ["a".repeat(60), `A${"a".repeat(59)}`],
    ["one two three four five six seven eight nine", null],
    [
      "one two three four five six seven eight",
      "One two three four five six seven eight",
    ],
  ])("normalizes %j", (input, expected) => {
    expect(normalizeTitle(input ?? "")).toBe(expected);
  });
});

describe(TitleGenerator, () => {
  afterEach(async () => {
    await Promise.all(generators.splice(0).map((value) => value.close()));
    vi.useRealTimers();
  });

  it("uses the shared runtime catalog without probing or taking ownership of it", async () => {
    const load = vi.fn<() => Promise<unknown[]>>();
    const models = new ModelCatalog("/nonexistent/droid", load);
    models.remember([{ id: "auto" }]);
    const list = vi.spyOn(models, "list");
    const close = vi.spyOn(models, "close");
    const value = new TitleGenerator({
      droidPath: "/nonexistent/droid",
      models,
      runner: () => Promise.resolve({ success: true, text: "Fix API errors" }),
    });
    generators.push(value);
    await expect(value.generate(INPUT)).resolves.toBe("Fix API errors");
    await value.close();
    expect(list).toHaveBeenCalledOnce();
    expect(load).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    await models.close();
  });

  it("uses Auto in an empty disposable folder and clips the goal", async () => {
    const captured = Promise.withResolvers<{
      prompt: string;
      options: RunOptions;
      files: string[];
    }>();
    const value = generator(async (prompt, options) => {
      captured.resolve({
        files: await readdir(options.cwd ?? ""),
        options,
        prompt,
      });
      return { success: true, text: '"Fix API errors"' };
    });
    const result = await value.generate({ ...INPUT, goal: "x".repeat(3000) });
    const run = await captured.promise;
    expect({
      files: run.files,
      model: run.options.modelId,
      rejected: run.options.autoRejectPermissionRequests,
      result,
    }).toStrictEqual({
      files: [],
      model: "auto",
      rejected: true,
      result: "Fix API errors",
    });
    expect(run.prompt).toBe(`Project: Missions\nGoal: ${"x".repeat(2000)}`);
    expect(run.options.systemPrompt).toContain("Use no tools");
    expect(existsSync(path.dirname(run.options.cwd ?? ""))).toBeFalsy();
  });

  it("skips a Droid catalog with no Auto model", async () => {
    const runner = vi.fn<TitleRunner>();
    await expect(
      generator(runner, { models: [], source: "droid" }).generate(INPUT)
    ).resolves.toBeNull();
    expect(runner).not.toHaveBeenCalled();
  });

  it("attempts Auto when discovery is unavailable", async () => {
    const runner = vi
      .fn<TitleRunner>()
      .mockResolvedValue({ success: true, text: "Fix API errors" });
    await expect(
      generator(runner, { models: [], source: "unavailable" }).generate(INPUT)
    ).resolves.toBe("Fix API errors");
    expect(runner).toHaveBeenCalledOnce();
  });

  it.each([
    { success: true, text: "one two three four five six seven eight nine" },
    { success: false, text: "Fix API errors" },
  ])(
    "keeps the placeholder for an unsuccessful or junk result: %j",
    async (result) => {
      await expect(
        generator(() => Promise.resolve(result)).generate(INPUT)
      ).resolves.toBeNull();
    }
  );

  it.each(["timeout", "close"])(
    "aborts on %s and removes its temporary folder",
    async (action) => {
      vi.useFakeTimers();
      const entered = Promise.withResolvers<RunOptions>();
      const value = generator((_prompt, options) => {
        entered.resolve(options);
        return Promise.withResolvers<{ success: boolean; text: string }>()
          .promise;
      });
      const pending = value.generate(INPUT);
      const options = await entered.promise;
      await (action === "timeout"
        ? vi.advanceTimersByTimeAsync(TITLE_TIMEOUT_MS)
        : value.close());
      const result = await pending;
      expect({
        aborted: options.abortSignal?.aborted,
        folder: existsSync(path.dirname(options.cwd ?? "")),
        result,
      }).toStrictEqual({ aborted: true, folder: false, result: null });
    }
  );

  it("caps active runs at two and admits queued runs as slots free", async () => {
    const releases: (() => void)[] = [];
    let active = 0;
    let peak = 0;
    const value = generator(async () => {
      active += 1;
      peak = Math.max(peak, active);
      const done = Promise.withResolvers<undefined>();
      releases.push(() => done.resolve(undefined));
      await done.promise;
      active -= 1;
      return { success: true, text: "Fix UI focus" };
    });
    const pending = Array.from({ length: 4 }, () => value.generate(INPUT));
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[0]?.();
    releases[1]?.();
    await vi.waitFor(() => expect(releases).toHaveLength(4));
    releases[2]?.();
    releases[3]?.();
    await expect(Promise.all(pending)).resolves.toStrictEqual(
      Array.from({ length: 4 }, () => "Fix UI focus")
    );
    expect(peak).toBe(2);
  });

  it("close cancels discovery, queued work and future calls", async () => {
    const runner = vi.fn<TitleRunner>();
    const value = new TitleGenerator({
      droidPath: "/nonexistent/droid",
      models: { list: () => Promise.withResolvers<ModelList>().promise },
      runner,
    });
    generators.push(value);
    const pending = Array.from({ length: 4 }, () => value.generate(INPUT));
    await value.close();
    await expect(Promise.all(pending)).resolves.toStrictEqual([
      null,
      null,
      null,
      null,
    ]);
    await expect(value.generate(INPUT)).resolves.toBeNull();
    expect(runner).not.toHaveBeenCalled();
  });
});
