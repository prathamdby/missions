import { OPERATION_HEADER } from "@missions/protocol/http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ApiRequestError } from "./api-error";
import { apiRequest } from "./client";
import { api } from "./endpoints";
import { isDefiniteFailure } from "./operation-intents";

describe("Typed HTTP requests", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(["not json", "{}"])(
    "treats malformed successful response %s as an unknown effect",
    async (body) => {
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(body))
      );
      const error: unknown = await apiRequest(
        "/test",
        z.object({ ok: z.boolean() })
      ).catch((error_: unknown) => error_);
      expect(error).toBeInstanceOf(ApiRequestError);
      expect(isDefiniteFailure(error)).toBeFalsy();
    }
  );

  it("sends operation identity in both body and header and preserves abort signals", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    await apiRequest("/test", z.object({ ok: z.boolean() }), {
      body: { operationId: "intent", text: "hello" },
      method: "POST",
      signal: controller.signal,
    });
    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get(OPERATION_HEADER)).toBe("intent");
    expect(JSON.parse(String(init.body))).toStrictEqual({
      operationId: "intent",
      text: "hello",
    });
    expect(init.signal).toBe(controller.signal);
  });

  it("forwards the optional final signal from every typed read endpoint", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(Response.json({}))
    );
    vi.stubGlobal("fetch", fetch);
    const { signal } = new AbortController();
    const reads = [
      () => api.changes("m", signal),
      () => api.checkout("p", signal),
      () => api.cloneJob("job", signal),
      () => api.connection(signal),
      () => api.file("m", "README.md", signal),
      () => api.files("m", "", signal),
      () => api.fsBrowse(undefined, signal),
      () => api.githubAuth(signal),
      () => api.githubRepos(undefined, signal),
      () => api.grants(signal),
      () => api.missionSnapshot("m", signal),
      () => api.missionTranscript("m", 10, 20, signal),
      () => api.missions(undefined, signal),
      () => api.models(signal),
      () => api.projectBranches("p", signal),
      () => api.projectWorktrees("p", signal),
      () => api.projects(signal),
      () => api.pullRequest("m", signal),
      () => api.pullRequests(signal),
      () => api.settings(signal),
    ];
    const results = await Promise.allSettled(reads.map((read) => read()));
    expect(
      results.every((result) => result.status === "rejected")
    ).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(reads.length);
    for (const [, options] of fetch.mock.calls) {
      expect((options as RequestInit).signal).toBe(signal);
    }
  });
});
