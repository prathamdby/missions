import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { ApiErrorSchema } from "@missions/protocol/errors";
import { SSE_EVENT } from "@missions/protocol/http";
import { CloneJobSchema, ProjectListSchema } from "@missions/protocol/projects";
import { routes } from "@missions/protocol/routes";
import { afterEach, describe, expect, it } from "vitest";

import type { DaemonConfig } from "./config";
import { createDaemon } from "./daemon";
import type { Daemon } from "./daemon";
import { pollUntil } from "./lib/async";
import { gitRepo, tempDir, testConfig } from "./test/fixtures";

const opened: Daemon[] = [];

const closeAll = async () => {
  await Promise.all(opened.splice(0).map((daemon) => daemon.close()));
};

const bodyOf = async (
  pending: Response | Promise<Response>
): Promise<unknown> => {
  const res = await pending;
  return await res.json();
};

const notice = (message: string) =>
  ({
    data: {
      notice: { code: "info", level: "info", message, retryAfterMs: null },
    },
    type: "notice",
  }) as const;

const start = async (config?: DaemonConfig) => {
  const daemon = await createDaemon({
    config: config ?? (await testConfig()),
    version: "test",
  });
  opened.push(daemon);
  return daemon;
};

const call = (
  daemon: Daemon,
  route: string,
  init: RequestInit = {},
  headers: Record<string, string> = {}
) =>
  daemon.app.request(route, {
    ...init,
    headers: {
      authorization: `Bearer ${daemon.token}`,
      "content-type": "application/json",
      host: "127.0.0.1:4317",
      ...headers,
    },
  });

const post = (daemon: Daemon, route: string, body: unknown) =>
  call(daemon, route, { body: JSON.stringify(body), method: "POST" });

describe("daemon", () => {
  afterEach(closeAll);

  describe("loopback boundary", () => {
    it("rejects foreign hosts, browser origins, and missing tokens", async () => {
      const daemon = await start();
      const codes = await Promise.all([
        call(daemon, routes.projects(), {}, { host: "evil.example:4317" }),
        call(
          daemon,
          routes.projects(),
          {},
          { origin: "http://127.0.0.1:4318" }
        ),
        call(daemon, routes.projects(), {}, { authorization: "Bearer wrong" }),
        call(daemon, routes.projects()),
      ]);
      expect(codes.map((res) => res.status)).toStrictEqual([
        403, 403, 401, 200,
      ]);
      expect(ApiErrorSchema.parse(await codes[2]?.json()).error.code).toBe(
        "unauthorized"
      );
    });
  });

  describe("projects", () => {
    it("adds a repository by any folder inside it and survives a restart", async () => {
      const config = await testConfig();
      const repo = await gitRepo("alpha");
      await mkdir(path.join(repo, "src"));
      const first = await start(config);
      const added = await post(first, routes.projects(), {
        operationId: "add-alpha-1",
        path: path.join(repo, "src"),
      });
      await expect(added.json()).resolves.toMatchObject({
        project: { kind: "git", name: "alpha", path: repo },
        status: "added",
      });
      await first.close();
      const second = await start(config);
      const list = ProjectListSchema.parse(
        await bodyOf(call(second, routes.projects()))
      );
      expect(list.projects.map((project) => project.path)).toStrictEqual([
        repo,
      ]);
    });

    it("asks before initializing Git in a plain folder", async () => {
      const daemon = await start();
      const dir = await tempDir("plain");
      const first = await post(daemon, routes.projects(), {
        operationId: "add-plain-1",
        path: dir,
      });
      await expect(first.json()).resolves.toStrictEqual({
        path: dir,
        status: "not_git",
      });
      expect(existsSync(path.join(dir, ".git"))).toBeFalsy();
      const second = await post(daemon, routes.projects(), {
        initializeGit: true,
        operationId: "add-plain-2",
        path: dir,
      });
      await expect(second.json()).resolves.toMatchObject({ status: "added" });
    });

    it("clones from a URL, reports failures, and refuses existing destinations", async () => {
      const daemon = await start();
      const source = await gitRepo("beta");
      const parent = await tempDir("clones");
      const clone = (url: string, operationId: string) =>
        post(daemon, routes.clone(), {
          destinationParent: parent,
          operationId,
          source: { kind: "url", url },
        });
      const job = CloneJobSchema.parse(
        await bodyOf(clone(source, "clone-ok-1"))
      );
      const done = await pollUntil(
        async () =>
          CloneJobSchema.parse(
            await bodyOf(call(daemon, routes.cloneJob(job.id)))
          ),
        (current) => current.status !== "cloning",
        Date.now() + 20_000,
        50
      );
      expect(done).toMatchObject({
        destination: path.join(parent, "beta"),
        status: "succeeded",
      });
      const again = CloneJobSchema.parse(
        await bodyOf(clone(source, "clone-dup-1"))
      );
      expect(again.error?.code).toBe("destination_exists");
      const missing = CloneJobSchema.parse(
        await bodyOf(clone(path.join(parent, "nope"), "clone-bad-1"))
      );
      const failed = await pollUntil(
        async () =>
          CloneJobSchema.parse(
            await bodyOf(call(daemon, routes.cloneJob(missing.id)))
          ),
        (current) => current.status !== "cloning",
        Date.now() + 20_000,
        50
      );
      expect(failed.status).toBe("failed");
      expect(existsSync(path.join(parent, "nope"))).toBeFalsy();
      const relative = await clone("not a url", "clone-relative-1");
      expect(relative.status).toBe(400);
    });
  });

  describe("event stream", () => {
    it("replays after the cursor, then streams live events in order", async () => {
      const daemon = await start();
      daemon.log.publish(null, notice("one"));
      daemon.log.publish(null, notice("two"));
      const controller = new AbortController();
      const res = await call(daemon, `${routes.events()}?after=1`, {
        signal: controller.signal,
      });
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let text = "";
      daemon.log.publish(null, notice("three"));
      const ids = await pollUntil(
        async () => {
          const chunk = await reader?.read();
          text += decoder.decode(chunk?.value ?? new Uint8Array());
          return [...text.matchAll(/^id: (?<id>\d+)$/gmu)].map((match) =>
            Number(match.groups?.id)
          );
        },
        (found) => found.length >= 2,
        Date.now() + 5000,
        0
      );
      controller.abort();
      expect(ids).toStrictEqual([2, 3]);
      expect(text).toContain(`event: ${SSE_EVENT}`);
    });
  });

  describe("dirty user work", () => {
    it("is never touched by adding a project", async () => {
      const daemon = await start();
      const repo = await gitRepo("gamma");
      await writeFile(path.join(repo, "README.md"), "user edit\n");
      await post(daemon, routes.projects(), {
        operationId: "add-gamma-1",
        path: repo,
      });
      const res = await call(
        daemon,
        routes.projectCheckout(daemon.projects.list()[0]?.id ?? "")
      );
      await expect(res.json()).resolves.toMatchObject({
        dirty: true,
        dirtyFiles: ["README.md"],
      });
    });
  });
});
