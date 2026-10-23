import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "../api/api-error";
import {
  useBranches,
  useChanges,
  useCheckout,
  useCloneJob,
  useConnectionStatus,
  useFileContent,
  useFileTree,
  useFsBrowse,
  useGithubAuth,
  useGithubRepos,
  useGrants,
  useMissions,
  useModels,
  useProjects,
  usePullRequestsQuery,
  useSettings,
  useSharedFiles,
  useSharedFile,
  useWorktrees,
} from "../api/queries";
import { queryKeys } from "../api/query-keys";
import { makeQueryClient } from "../query-provider";

const adapter = vi.hoisted(() => ({
  calls: [] as { args: unknown[]; name: string }[],
}));

vi.mock<{ api: unknown }>(import("../api/endpoints"), () => {
  const responses: Record<string, unknown> = {
    changes: {},
    checkout: {},
    cloneJob: { status: "succeeded" },
    connection: {},
    file: {},
    files: {},
    fsBrowse: {},
    githubAuth: {},
    githubRepos: { repos: [] },
    grants: { grants: [] },
    missions: { missions: [] },
    models: { models: [] },
    projectBranches: { branches: [] },
    projectWorktrees: { worktrees: [] },
    projects: { projects: [] },
    pullRequests: { pullRequests: [] },
    settings: {},
    sharedFile: {},
    sharedFiles: {},
  };
  return {
    api: Object.fromEntries(
      Object.entries(responses).map(([name, response]) => [
        name,
        (...args: unknown[]) => {
          adapter.calls.push({ args, name });
          return Promise.resolve(response);
        },
      ])
    ),
  };
});

const clients: QueryClient[] = [];
const clientForTest = () => {
  const client = makeQueryClient();
  clients.push(client);
  return client;
};

/** Render actual hooks with a real client; only the owned read transport varies. */
const QueryProbe = ({ workspaceSeq }: { workspaceSeq: number }) => {
  useProjects();
  useMissions();
  useSettings();
  useModels();
  useConnectionStatus();
  useGrants();
  usePullRequestsQuery();
  useChanges("m-1", workspaceSeq);
  useFileTree("m-1", "src", workspaceSeq);
  useFileContent("m-1", "src/main.ts", workspaceSeq);
  useSharedFiles("m-1", "plans");
  useSharedFile("m-1", "plans/plan.md");
  useBranches("p-1");
  useWorktrees("p-1");
  useCheckout("p-1");
  useFsBrowse("/home");
  useGithubAuth();
  useGithubRepos("mission", true);
  useCloneJob("clone-1");
  return null;
};

describe("read query policy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    adapter.calls.length = 0;
  });
  afterEach(() => {
    for (const client of clients.splice(0)) {
      client.clear();
    }
    vi.useRealTimers();
  });

  it("every read hook forwards the QueryClient AbortSignal to its endpoint", async () => {
    const client = clientForTest();
    renderToString(
      createElement(
        QueryClientProvider,
        { client },
        createElement(QueryProbe, { workspaceSeq: 10 })
      )
    );
    const results = await Promise.allSettled(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.fetch())
    );
    expect(
      results.every((result) => result.status === "fulfilled")
    ).toBeTruthy();
    expect(adapter.calls).toHaveLength(19);
    expect(
      adapter.calls.every((call) => call.args.at(-1) instanceof AbortSignal)
    ).toBeTruthy();
    expect(client.getQueryData(queryKeys.pullRequests)).toStrictEqual([]);
  });

  it("workspace sequence changes reuse exactly the same changes/tree/content resources", () => {
    const client = clientForTest();
    renderToString(
      createElement(
        QueryClientProvider,
        { client },
        createElement(QueryProbe, { workspaceSeq: 1 })
      )
    );
    renderToString(
      createElement(
        QueryClientProvider,
        { client },
        createElement(QueryProbe, { workspaceSeq: 20_000 })
      )
    );
    expect(client.getQueryCache().getAll()).toHaveLength(19);
    expect(
      client
        .getQueryCache()
        .findAll({ queryKey: ["mission", "m-1"] })
        .map((query) => query.queryKey)
    ).toStrictEqual([
      queryKeys.changes("m-1"),
      queryKeys.files("m-1", "src"),
      queryKeys.file("m-1", "src/main.ts"),
      [...queryKeys.files("m-1", "shared"), "plans"],
      [...queryKeys.file("m-1", "shared"), "plans/plan.md"],
    ]);
  });

  it.each([
    {
      attempts: 3,
      error: new ApiRequestError({
        code: "internal",
        message: "Unavailable",
        status: 503,
      }),
      name: "transient daemon errors",
    },
    {
      attempts: 1,
      error: new ApiRequestError({
        code: "unauthorized",
        message: "Sign in",
        status: 401,
      }),
      name: "authorization errors",
    },
    {
      attempts: 1,
      error: new DOMException("Cancelled", "AbortError"),
      name: "aborted reads",
    },
  ])("retries $name at most $attempts times", async ({ attempts, error }) => {
    const client = clientForTest();
    const queryFn = vi.fn<() => Promise<string>>().mockRejectedValue(error);
    const pending = client
      .fetchQuery({ queryFn, queryKey: ["retry-policy"] })
      .catch((error_: unknown) => error_);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toBe(error);
    expect(queryFn).toHaveBeenCalledTimes(attempts);
  });
});
