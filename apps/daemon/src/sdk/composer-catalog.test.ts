import { afterEach, describe, expect, it, vi } from "vitest";

import { ComposerCatalog } from "./composer-catalog";
import type { ComposerRuntime, RawComposerCatalog } from "./composer-catalog";
import { MODEL_PROBE_TIMEOUT_MS } from "./startup";

const RAW: RawComposerCatalog = {
  commands: [
    { argumentHint: "<path>", description: "Inspect a file", name: "inspect" },
  ],
  skills: [
    { description: "Review changes", name: "review" },
    { enabled: false, name: "disabled" },
    { name: "internal", userInvocable: false },
  ],
};

describe(ComposerCatalog, () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("prefers a ready runtime and filters unavailable skills", async () => {
    const probe = vi
      .fn<(cwd: string) => Promise<RawComposerCatalog>>()
      .mockResolvedValue(RAW);
    const catalog = new ComposerCatalog("missing", { probe });
    const runtime = {
      listCommands: vi
        .fn<ComposerRuntime["listCommands"]>()
        .mockResolvedValue(RAW.commands),
      listSkills: vi
        .fn<ComposerRuntime["listSkills"]>()
        .mockResolvedValue(RAW.skills),
    };
    const result = await catalog.list("/project", runtime);
    expect(result).toStrictEqual({
      commands: [
        {
          argumentHint: "<path>",
          description: "Inspect a file",
          kind: "command",
          name: "inspect",
        },
        { description: "Review changes", kind: "skill", name: "review" },
      ],
      source: "droid",
    });
    expect(probe).not.toHaveBeenCalled();
    await catalog.close();
  });

  it("falls back to a cwd-scoped probe after runtime errors", async () => {
    const probe = vi
      .fn<(cwd: string) => Promise<RawComposerCatalog>>()
      .mockResolvedValue(RAW);
    const catalog = new ComposerCatalog("missing", { probe });
    const runtime = {
      listCommands: () => Promise.resolve([]),
      listSkills: () => Promise.reject(new Error("retired")),
    };
    await expect(catalog.list("/project", runtime)).resolves.toMatchObject({
      source: "droid",
    });
    expect(probe).toHaveBeenCalledWith("/project");
    await catalog.close();
  });

  it("shares in-flight work and caches each cwd for ten minutes", async () => {
    let now = 0;
    const waiting = Promise.withResolvers<RawComposerCatalog>();
    const probe = vi
      .fn<(cwd: string) => Promise<RawComposerCatalog>>()
      .mockReturnValueOnce(waiting.promise)
      .mockResolvedValue(RAW);
    const catalog = new ComposerCatalog("missing", { now: () => now, probe });
    const first = catalog.list("/project");
    const second = catalog.list("/project");
    waiting.resolve(RAW);
    await Promise.all([first, second]);
    await catalog.list("/project");
    expect(probe).toHaveBeenCalledOnce();
    await catalog.list("/other");
    now = 600_001;
    await catalog.list("/project");
    expect(probe).toHaveBeenCalledTimes(3);
    await catalog.close();
  });

  it("bounds hung discovery and permits retry", async () => {
    vi.useFakeTimers();
    const probe = vi
      .fn<(cwd: string) => Promise<RawComposerCatalog>>()
      .mockReturnValueOnce(Promise.withResolvers<RawComposerCatalog>().promise)
      .mockResolvedValue(RAW);
    const catalog = new ComposerCatalog("missing", { probe });
    const pending = catalog.list("/project");
    await vi.advanceTimersByTimeAsync(MODEL_PROBE_TIMEOUT_MS);
    await expect(pending).resolves.toStrictEqual({
      commands: [],
      source: "unavailable",
    });
    await expect(catalog.list("/project")).resolves.toMatchObject({
      source: "droid",
    });
    expect(vi.getTimerCount()).toBe(0);
    await catalog.close();
  });

  it("cancels discovery on shutdown without leaving a deadline", async () => {
    vi.useFakeTimers();
    const catalog = new ComposerCatalog("missing", {
      probe: () => Promise.withResolvers<RawComposerCatalog>().promise,
    });
    const pending = catalog.list("/project");
    await catalog.close();
    await expect(pending).resolves.toStrictEqual({
      commands: [],
      source: "unavailable",
    });
    await expect(catalog.list("/project")).resolves.toStrictEqual({
      commands: [],
      source: "unavailable",
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
