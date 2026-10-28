import { CommandAcceptedSchema } from "@missions/protocol/commands";
import { ApiErrorSchema } from "@missions/protocol/errors";
import { EVENTS_PATH } from "@missions/protocol/events";
import { routes } from "@missions/protocol/routes";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Daemon } from "../daemon";
import {
  bootDaemon,
  control,
  MODEL,
  pausedMission,
  startMission,
} from "../test/mission-harness";

const opened: Daemon[] = [];

const send = (
  ctx: Awaited<ReturnType<typeof pausedMission>>,
  path: string,
  init: { method?: string; body?: string } = {}
) =>
  ctx.daemon.app.request(path, {
    body: init.body,
    headers: {
      authorization: `Bearer ${ctx.daemon.token}`,
      "content-type": "application/json",
      host: `127.0.0.1:${ctx.config.port}`,
    },
    method: init.method ?? "GET",
  });

const failureOf = async (response: Response) => {
  const body = ApiErrorSchema.parse(await response.json());
  return [response.status, body.error.code];
};

describe("mission routes", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(opened.splice(0).map((daemon) => daemon.close()));
  });

  it("validates rewind text and maps missing, foreign and stale targets", async () => {
    const ctx = await startMission(await bootDaemon(opened));
    ctx.orchestrator.consume(`${ctx.missionId}:goal`);
    const [item] = ctx.daemon.store.listTranscript(ctx.missionId);
    if (!item) {
      throw new Error("Missing transcript item");
    }
    const request = {
      ...control(ctx.daemon, ctx.missionId, "rewind-http-validation"),
      text: "Changed goal",
    };
    const cases = [
      {
        body: { ...request, text: "   " },
        code: "bad_request",
        itemId: item.id,
        status: 400,
      },
      { body: request, code: "not_found", itemId: "unknown-item", status: 404 },
      {
        body: { ...request, expectedRevision: 0 },
        code: "stale_revision",
        itemId: item.id,
        status: 409,
      },
    ];
    const other = await startMission(ctx, "other");
    other.orchestrator.consume(`${other.missionId}:goal`);
    const [foreign] = ctx.daemon.store.listTranscript(other.missionId);
    if (!foreign) {
      throw new Error("Missing foreign transcript item");
    }
    cases.push({
      body: request,
      code: "not_found",
      itemId: foreign.id,
      status: 404,
    });
    const outcomes = await Promise.all(
      cases.map(async (entry) => {
        const response = await send(
          ctx,
          routes.transcriptRewind(ctx.missionId, entry.itemId),
          { body: JSON.stringify(entry.body), method: "POST" }
        );
        return await failureOf(response);
      })
    );
    expect(outcomes).toStrictEqual(
      cases.map((entry) => [entry.status, entry.code])
    );
    expect(ctx.daemon.store.getTranscriptItem(item.id)?.text).toBe(item.text);
  });

  it("maps a rejected rewind stop to a conflict instead of an internal error", async () => {
    const ctx = await startMission(await bootDaemon(opened));
    ctx.orchestrator.consume(`${ctx.missionId}:goal`);
    const [item] = ctx.daemon.store.listTranscript(ctx.missionId);
    if (!item) {
      throw new Error("Missing transcript item");
    }
    vi.spyOn(ctx.orchestrator, "close").mockRejectedValueOnce(
      new Error("stop failed")
    );
    const response = await send(
      ctx,
      routes.transcriptRewind(ctx.missionId, item.id),
      {
        body: JSON.stringify({
          ...control(ctx.daemon, ctx.missionId, "rewind-http-stop"),
          text: "Changed goal",
        }),
        method: "POST",
      }
    );
    await expect(failureOf(response)).resolves.toStrictEqual([409, "conflict"]);
    expect(ctx.daemon.store.getTranscriptItem(item.id)?.text).toBe(item.text);
    opened.splice(opened.indexOf(ctx.daemon), 1);
    await expect(ctx.daemon.close()).rejects.toThrow(/shutdown failed/u);
  });

  it.each([
    { executionMode: "work" },
    { executionMode: "plan" },
    { autonomy: "high" },
    { defaultAutonomy: "high" },
    { pendingExecutionMode: "plan" },
    { autonomy: "high", executionMode: "plan" },
  ])(
    "rejects removed request fields %j on creation and messages",
    async (legacy) => {
      const ctx = await startMission(await bootDaemon(opened));
      const create = await send(ctx, routes.missions(), {
        body: JSON.stringify({
          ...legacy,
          goal: "Write notes",
          operationId: "removed-mode-create",
          orchestrator: MODEL,
          projectId: ctx.projectId,
          worker: MODEL,
          workspace: { mode: "current_checkout" },
        }),
        method: "POST",
      });
      await expect(failureOf(create)).resolves.toStrictEqual([
        400,
        "bad_request",
      ]);
      const message = await send(ctx, routes.missionMessages(ctx.missionId), {
        body: JSON.stringify({
          ...legacy,
          mode: "steer",
          operationId: "removed-mode-message",
          text: "Plan this",
        }),
        method: "POST",
      });
      await expect(failureOf(message)).resolves.toStrictEqual([
        400,
        "bad_request",
      ]);
      expect(ctx.daemon.missions.get(ctx.missionId).executionMode).toBe("work");
    }
  );

  it("validates the MissionControlRequest body before acting", async () => {
    const ctx = await pausedMission(await bootDaemon(opened));
    const { revision } = ctx.daemon.missions.get(ctx.missionId);
    const invalid = [
      "not json",
      JSON.stringify({ expectedRevision: revision }),
      JSON.stringify({ operationId: "delete-http-1" }),
      JSON.stringify({ expectedRevision: revision, operationId: "short" }),
      JSON.stringify({
        expectedRevision: revision,
        force: true,
        operationId: "delete-http-1",
      }),
    ];
    const outcomes = await Promise.all(
      invalid.map(async (body) => {
        const response = await send(ctx, routes.mission(ctx.missionId), {
          body,
          method: "DELETE",
        });
        return await failureOf(response);
      })
    );
    expect(outcomes).toStrictEqual(invalid.map(() => [400, "bad_request"]));
    expect(ctx.daemon.missions.get(ctx.missionId).status).toBe("paused");
  });

  it("accepts once, replays duplicates and then answers 404", async () => {
    const ctx = await pausedMission(await bootDaemon(opened));
    const body = JSON.stringify(
      control(ctx.daemon, ctx.missionId, "delete-http-ok")
    );
    const accepted = await send(ctx, routes.mission(ctx.missionId), {
      body,
      method: "DELETE",
    });
    expect([
      accepted.status,
      CommandAcceptedSchema.parse(await accepted.json()),
    ]).toStrictEqual([
      200,
      { operationId: "delete-http-ok", status: "accepted" },
    ]);
    const duplicate = await send(ctx, routes.mission(ctx.missionId), {
      body,
      method: "DELETE",
    });
    expect(CommandAcceptedSchema.parse(await duplicate.json()).status).toBe(
      "duplicate"
    );
    const read = await send(ctx, routes.mission(ctx.missionId));
    await expect(failureOf(read)).resolves.toStrictEqual([404, "not_found"]);
    const another = await send(ctx, routes.mission(ctx.missionId), {
      body: JSON.stringify({
        expectedRevision: 0,
        operationId: "delete-http-new",
      }),
      method: "DELETE",
    });
    expect(another.status).toBe(404);
    const stream = await send(
      ctx,
      `${EVENTS_PATH}?missionId=${ctx.missionId}&after=0`
    );
    await expect(failureOf(stream)).resolves.toStrictEqual([404, "not_found"]);
  });

  it("maps stale revisions and running missions to 409", async () => {
    const booted = await bootDaemon(opened);
    const ctx = await pausedMission(booted);
    const stale = await send(ctx, routes.mission(ctx.missionId), {
      body: JSON.stringify({
        expectedRevision: ctx.daemon.missions.get(ctx.missionId).revision + 1,
        operationId: "delete-http-stale",
      }),
      method: "DELETE",
    });
    await expect(failureOf(stale)).resolves.toStrictEqual([
      409,
      "stale_revision",
    ]);
    const running = await startMission(booted, "2");
    const active = await send(running, routes.mission(running.missionId), {
      body: JSON.stringify(
        control(running.daemon, running.missionId, "delete-http-running")
      ),
      method: "DELETE",
    });
    await expect(failureOf(active)).resolves.toStrictEqual([409, "conflict"]);
  });
});
