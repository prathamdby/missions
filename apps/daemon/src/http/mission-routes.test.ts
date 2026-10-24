import { CommandAcceptedSchema } from "@missions/protocol/commands";
import { ApiErrorSchema } from "@missions/protocol/errors";
import { EVENTS_PATH } from "@missions/protocol/events";
import { routes } from "@missions/protocol/routes";
import { afterEach, describe, expect, it } from "vitest";

import type { Daemon } from "../daemon";
import {
  bootDaemon,
  control,
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

describe("DELETE mission(id)", () => {
  afterEach(async () => {
    await Promise.all(opened.splice(0).map((daemon) => daemon.close()));
  });

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
