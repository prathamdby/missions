import type {
  AddLocalProjectRequest,
  AddLocalProjectResponse,
  CloneJob,
  CloneProjectRequest,
  CloneSource,
  Project,
} from "@missions/protocol/projects";
import { describe, expect, it } from "vitest";

import { ApiRequestError } from "../../lib/api/api-error";
import { OperationIntents } from "../../lib/api/operation-intents";
import { AddProjectSession } from "./add-project-session";

const project: Project = {
  createdAt: "2026-01-01T00:00:00Z",
  defaultBranch: "main",
  id: "project",
  kind: "git",
  name: "Example",
  path: "/code/example",
  remoteUrl: null,
};
const source: CloneSource = { kind: "github", repo: "owner/example" };
const job = (id = "job"): CloneJob => ({
  createdAt: project.createdAt,
  destination: project.path,
  error: null,
  id,
  progress: null,
  projectId: null,
  source,
  status: "cloning",
});

class FakeProjects {
  readonly adds: {
    request: AddLocalProjectRequest;
    result: ReturnType<typeof Promise.withResolvers<AddLocalProjectResponse>>;
  }[] = [];
  readonly clones: {
    request: CloneProjectRequest;
    result: ReturnType<typeof Promise.withResolvers<CloneJob>>;
  }[] = [];
  add = (request: AddLocalProjectRequest) => {
    const result = Promise.withResolvers<AddLocalProjectResponse>();
    this.adds.push({ request, result });
    return result.promise;
  };
  clone = (request: CloneProjectRequest) => {
    const result = Promise.withResolvers<CloneJob>();
    this.clones.push({ request, result });
    return result.promise;
  };
}

const setup = () => {
  const remote = new FakeProjects();
  const added: { project: Project; via: string }[] = [];
  const cachedProjects: Project[] = [];
  const cachedJobs: CloneJob[] = [];
  let next = 0;
  const session = new AddProjectSession({
    add: remote.add,
    clone: remote.clone,
    intents: new OperationIntents(() => {
      next += 1;
      return `operation-${next}`;
    }),
    onAdded: (value, via) => added.push({ project: value, via }),
    rememberJob: (value) => cachedJobs.push(value),
    rememberProject: (value) => cachedProjects.push(value),
  });
  session.open();
  return { added, cachedJobs, cachedProjects, remote, session };
};

describe("projects workflows", () => {
  it("admits back and retry only for a failed clone and restores the source flow", async () => {
    const { remote, session } = setup();
    session.open("github");
    session.setGithub({
      chosen: "owner/example",
      owner: "owner",
      search: "example",
    });
    session.pickParent();
    session.back();
    const pending = session.clone(source);
    session.chooseUrl();
    remote.clones[0]?.result.resolve(job());
    await pending;
    await session.clone();
    session.back();
    expect({
      requests: remote.clones.length,
      step: session.getSnapshot().step.kind,
    }).toStrictEqual({ requests: 1, step: "cloning" });
    session.observeClone({ ...job(), status: "failed" }, []);
    session.back();
    expect(session.getSnapshot()).toMatchObject({
      github: { chosen: "owner/example", owner: "owner", search: "example" },
      step: { kind: "github" },
    });
  });

  it("admits only one add synchronously and completes selection/toast/navigation once", async () => {
    const { added, remote, session } = setup();
    const pending = session.add(project.path, false);
    await session.add(project.path, false);
    session.chooseUrl();
    expect(remote.adds).toHaveLength(1);
    expect(session.getSnapshot().step.kind).toBe("browse");
    remote.adds[0]?.result.resolve({ project, status: "added" });
    await pending;
    await session.add(project.path, false);
    expect(added).toStrictEqual([{ project, via: "local" }]);
    expect(session.getSnapshot().open).toBeFalsy();
  });

  it("late local success updates the cache but cannot close or complete a reopened flow", async () => {
    const { added, cachedProjects, remote, session } = setup();
    const old = session.add(project.path, false);
    session.close();
    session.open("url");
    session.setUrl("git@example.com:owner/new.git");
    remote.adds[0]?.result.resolve({ project, status: "added" });
    await old;
    expect(cachedProjects).toStrictEqual([project]);
    expect(added).toStrictEqual([]);
    expect(session.getSnapshot()).toMatchObject({
      open: true,
      pending: false,
      step: { kind: "url" },
      url: "git@example.com:owner/new.git",
    });
  });

  it("late not-git and late errors cannot contaminate a new browsing generation", async () => {
    const { remote, session } = setup();
    const old = session.add("/not-git", false);
    session.close();
    session.open();
    const current = session.add("/new", false);
    remote.adds[0]?.result.resolve({ path: "/not-git", status: "not_git" });
    await old;
    expect(session.getSnapshot()).toMatchObject({
      notGitPath: null,
      pending: true,
    });
    remote.adds[1]?.result.reject(new Error("offline"));
    await current;
    expect(session.getSnapshot().error).toStrictEqual(new Error("offline"));
    session.close();
    session.open();
    expect(session.getSnapshot().error).toBeNull();
  });

  it("not-git initialization is a separate complete request intent", async () => {
    const { remote, session } = setup();
    const first = session.add("/plain", false);
    remote.adds[0]?.result.resolve({ path: "/plain", status: "not_git" });
    await first;
    expect(session.getSnapshot().notGitPath).toBe("/plain");
    const initialize = session.add("/plain", true);
    expect(remote.adds[1]?.request.operationId).not.toBe(
      remote.adds[0]?.request.operationId
    );
    remote.adds[1]?.result.resolve({ project, status: "added" });
    await initialize;
  });

  it("retains uncertain A and B retries independently, releasing only a rejected request", async () => {
    const { remote, session } = setup();
    const a = session.add("/a", false);
    remote.adds[0]?.result.reject(new Error("connection lost"));
    await a;
    const b = session.add("/b", false);
    remote.adds[1]?.result.reject(
      new ApiRequestError({ code: "conflict", message: "busy", status: 409 })
    );
    await b;
    const retryA = session.add("/a", false);
    expect(remote.adds[2]?.request.operationId).toBe(
      remote.adds[0]?.request.operationId
    );
    remote.adds[2]?.result.reject(new Error("still offline"));
    await retryA;
    const retryB = session.add("/b", false);
    expect(remote.adds[3]?.request.operationId).not.toBe(
      remote.adds[1]?.request.operationId
    );
    remote.adds[3]?.result.resolve({ project, status: "added" });
    await retryB;
  });

  it("isolates old clone start and errors from a concurrent reopened clone", async () => {
    const { added, remote, session } = setup();
    session.open("github");
    const old = session.clone(source);
    session.close();
    session.open("github");
    const current = session.clone(source);
    remote.clones[0]?.result.resolve(job("old"));
    await old;
    expect(session.getSnapshot()).toMatchObject({
      pending: true,
      step: { kind: "github" },
    });
    remote.clones[1]?.result.resolve(job("new"));
    await current;
    session.observeClone(
      { ...job("old"), projectId: project.id, status: "succeeded" },
      [project]
    );
    expect(added).toStrictEqual([]);
    session.observeClone(
      { ...job("new"), projectId: project.id, status: "succeeded" },
      [project]
    );
    expect(added).toStrictEqual([{ project, via: "clone" }]);
  });

  it("owns completion across presentation unmounts and waits for the confirmed project", async () => {
    const { added, remote, session } = setup();
    session.open("github");
    const pending = session.clone(source);
    remote.clones[0]?.result.resolve(job());
    await pending;
    const unsubscribe = session.subscribe(() => {});
    unsubscribe();
    const succeeded = {
      ...job(),
      projectId: project.id,
      status: "succeeded" as const,
    };
    session.observeClone(succeeded, []);
    expect(added).toStrictEqual([]);
    session.observeClone(succeeded, [project]);
    session.observeClone(succeeded, [project]);
    expect(added).toStrictEqual([{ project, via: "clone" }]);
  });

  it("closing a clone suppresses late completion without claiming the daemon cancelled it", async () => {
    const { added, remote, session } = setup();
    session.open("github");
    const pending = session.clone(source);
    remote.clones[0]?.result.resolve(job());
    await pending;
    session.close();
    session.observeClone(
      { ...job(), projectId: project.id, status: "succeeded" },
      [project]
    );
    expect(added).toStrictEqual([]);
    expect(session.getSnapshot().step.kind).toBe("cloning");
  });

  it("preserves URL and GitHub drafts through the parent picker and captures clone retries", async () => {
    const { remote, session } = setup();
    session.open("url");
    session.setUrl("git@host:owner/repo.git");
    session.setGithub({ chosen: "owner/repo", owner: "owner", search: "repo" });
    session.pickParent();
    session.chooseParent("/chosen");
    expect(session.getSnapshot()).toMatchObject({
      cloneParent: "/chosen",
      github: { chosen: "owner/repo", owner: "owner", search: "repo" },
      step: { kind: "url" },
      url: "git@host:owner/repo.git",
    });
    const mutable: CloneSource = {
      kind: "url",
      url: "git@host:owner/repo.git",
    };
    const first = session.clone(mutable);
    mutable.url = "git@host:owner/changed.git";
    remote.clones[0]?.result.reject(new Error("lost response"));
    await first;
    session.pickParent();
    session.chooseParent("/different");
    const retry = session.clone();
    expect(remote.clones[1]?.request).toStrictEqual(remote.clones[0]?.request);
    remote.clones[1]?.result.resolve({
      ...job(),
      source: remote.clones[1].request.source,
    });
    await retry;
    session.observeClone({ ...job(), status: "failed" }, []);
    const retryFailedJob = session.clone();
    expect(remote.clones[2]?.request.destinationParent).toBe("/chosen");
    expect(remote.clones[2]?.request.operationId).not.toBe(
      remote.clones[1]?.request.operationId
    );
    remote.clones[2]?.result.resolve(job("retry"));
    await retryFailedJob;
  });
});
