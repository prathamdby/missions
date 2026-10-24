import { setImmediate as tick } from "node:timers/promises";

import { ProcessTransport } from "@factory/droid-sdk/node";
import type { DaemonEvent } from "@missions/protocol/events";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Daemon } from "../daemon";
import {
  bootDaemon,
  control,
  startMission,
  waitFor,
} from "../test/mission-harness";
import { titleFromGoal } from "./messages";
import type { MissionTitleGenerator } from "./title-generator";

const opened: Daemon[] = [];
const setup = async () => {
  const title = Promise.withResolvers<string | null>();
  const generator: MissionTitleGenerator = {
    close: vi.fn<MissionTitleGenerator["close"]>(() => {
      title.resolve(null);
      return Promise.resolve();
    }),
    generate: vi.fn<MissionTitleGenerator["generate"]>(() => title.promise),
  };
  const booted = await bootDaemon(opened, undefined, undefined, generator);
  return { booted, generator, title };
};

describe("mission Auto titles", () => {
  afterEach(async () => {
    await Promise.all(opened.splice(0).map((daemon) => daemon.close()));
    vi.restoreAllMocks();
  });

  it("returns the placeholder first, then emits the generated title", async () => {
    const { booted, generator, title } = await setup();
    const seen: DaemonEvent[] = [];
    booted.daemon.log.subscribe((event) => seen.push(event));
    const ctx = await startMission(booted);
    const placeholder = titleFromGoal("Add a greeting file");
    expect(ctx.daemon.missions.get(ctx.missionId).title).toBe(placeholder);
    title.resolve("Add project greetings");
    await waitFor(
      () => ctx.daemon.missions.get(ctx.missionId).title,
      (value) => value === "Add project greetings"
    );
    const titles = seen
      .filter((event) => event.type === "mission.updated")
      .map((event) => event.data.mission.title);
    expect(titles).toContain(placeholder);
    expect(titles.at(-1)).toBe("Add project greetings");
    expect(generator.generate).toHaveBeenCalledOnce();
  });

  it("does not generate for an explicit title", async () => {
    const { booted, generator } = await setup();
    const ctx = await startMission(booted, "1", { title: "My chosen title" });
    expect(ctx.daemon.missions.get(ctx.missionId).title).toBe(
      "My chosen title"
    );
    expect(generator.generate).not.toHaveBeenCalled();
  });

  it("lets a rename made mid-generation win", async () => {
    const { booted, title } = await setup();
    const ctx = await startMission(booted);
    await ctx.daemon.missions.update(ctx.missionId, {
      expectedRevision: ctx.daemon.missions.get(ctx.missionId).revision,
      title: "User renamed this",
    });
    title.resolve("Generated title");
    await tick();
    expect(ctx.daemon.missions.get(ctx.missionId).title).toBe(
      "User renamed this"
    );
  });

  it("does not write or throw after deletion during generation", async () => {
    const { booted, title } = await setup();
    const ctx = await startMission(booted);
    await ctx.daemon.missions.pause(
      ctx.missionId,
      control(ctx.daemon, ctx.missionId, "pause-title-delete")
    );
    await ctx.daemon.missions.remove(
      ctx.missionId,
      control(ctx.daemon, ctx.missionId, "delete-during-title")
    );
    const seen: DaemonEvent[] = [];
    ctx.daemon.log.subscribe((event) => seen.push(event));
    title.resolve("Too late to write");
    await tick();
    expect(seen).toStrictEqual([]);
    expect(ctx.daemon.missions.list()).toStrictEqual([]);
    await expect(ctx.daemon.close()).resolves.toBeUndefined();
  });

  it.each(["User renamed this", "Add a greeting file"])(
    "keeps an explicit placeholder title after a rename to %s",
    async (firstTitle) => {
      const { booted, title } = await setup();
      const ctx = await startMission(booted);
      const placeholder = ctx.daemon.missions.get(ctx.missionId).title;
      await ctx.daemon.missions.update(ctx.missionId, {
        expectedRevision: ctx.daemon.missions.get(ctx.missionId).revision,
        title: firstTitle,
      });
      await ctx.daemon.missions.update(ctx.missionId, {
        expectedRevision: ctx.daemon.missions.get(ctx.missionId).revision,
        title: placeholder,
      });
      title.resolve("Generated title");
      await tick();
      expect(ctx.daemon.missions.get(ctx.missionId).title).toBe(placeholder);
    }
  );

  it("does not cancel a title for a rejected explicit rename", async () => {
    const { booted, title } = await setup();
    const ctx = await startMission(booted);
    await expect(
      ctx.daemon.missions.update(ctx.missionId, {
        expectedRevision: ctx.daemon.missions.get(ctx.missionId).revision + 1,
        title: "Rejected rename",
      })
    ).rejects.toMatchObject({ code: "stale_revision" });
    title.resolve("Generated title");
    await waitFor(
      () => ctx.daemon.missions.get(ctx.missionId).title,
      (value) => value === "Generated title"
    );
    expect(ctx.daemon.missions.get(ctx.missionId).title).toBe(
      "Generated title"
    );
  });

  it("rejects the old revision once, then accepts a reviewed retry", async () => {
    const { booted, title } = await setup();
    const ctx = await startMission(booted);
    const { revision } = ctx.daemon.missions.get(ctx.missionId);
    title.resolve("Add project greetings");
    await waitFor(
      () => ctx.daemon.missions.get(ctx.missionId).title,
      (value) => value === "Add project greetings"
    );
    await expect(
      ctx.daemon.missions.update(ctx.missionId, {
        expectedRevision: revision,
        title: "Retry rename",
      })
    ).rejects.toMatchObject({ code: "stale_revision" });
    await expect(
      ctx.daemon.missions.update(ctx.missionId, {
        expectedRevision: ctx.daemon.missions.get(ctx.missionId).revision,
        title: "Retry rename",
      })
    ).resolves.toMatchObject({ title: "Retry rename" });
  });

  it("keeps the placeholder when generation fails", async () => {
    const { booted, title } = await setup();
    const ctx = await startMission(booted);
    title.reject(new Error("title unavailable"));
    await tick();
    expect(ctx.daemon.missions.get(ctx.missionId).title).toBe(
      titleFromGoal("Add a greeting file")
    );
    await expect(ctx.daemon.close()).resolves.toBeUndefined();
  });

  it("createDaemon without the option never starts a title transport", async () => {
    const connect = vi.spyOn(ProcessTransport.prototype, "connect");
    const ctx = await startMission(await bootDaemon(opened));
    await tick();
    expect(ctx.daemon.missions.get(ctx.missionId).title).toBe(
      titleFromGoal("Add a greeting file")
    );
    expect(connect).not.toHaveBeenCalled();
  });

  it("does not retry title generation after restart", async () => {
    const { booted, generator } = await setup();
    const ctx = await startMission(booted);
    await ctx.daemon.close();
    await bootDaemon(opened, booted.config, undefined, generator);
    expect(generator.generate).toHaveBeenCalledOnce();
  });
});
