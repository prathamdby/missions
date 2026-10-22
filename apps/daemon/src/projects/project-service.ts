import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
  AddLocalProjectRequest,
  AddLocalProjectResponse,
  CloneJob,
  CloneProjectRequest,
  CloneSource,
  FsBrowseResponse,
  GithubAuthStatus,
  GithubRepo,
  Project,
} from "@missions/protocol/projects";
import { AddLocalProjectRequestSchema } from "@missions/protocol/projects";
import type { CheckoutStatus } from "@missions/protocol/workspaces";

import { expandHome } from "../config";
import type { OperationJournal } from "../db/journal";
import type { Store } from "../db/store";
import type { EventLog } from "../events/event-log";
import * as repo from "../git/repo";
import { AppError, badRequest, notFound } from "../lib/app-error";
import { git, redactUrl, run } from "../lib/exec";

export interface ProjectServiceOptions {
  store: Store;
  log: EventLog;
  journal: OperationJournal;
  reposDir: string;
  now?: () => Date;
}

type CloneErrorCode = NonNullable<CloneJob["error"]>["code"];

const AUTH_PATTERN =
  /authentication failed|could not read username|gh auth login|permission denied \(publickey\)|terminal prompts disabled/iu;
const NOT_FOUND_PATTERN = /repository not found|not found|does not exist/iu;
const NETWORK_PATTERN =
  /could not resolve host|network is unreachable|connection timed out|failed to connect/iu;
const PROGRESS_THROTTLE_MS = 250;

export const classifyCloneError = (stderr: string): CloneErrorCode => {
  if (AUTH_PATTERN.test(stderr)) {
    return "auth_required";
  }
  if (NETWORK_PATTERN.test(stderr)) {
    return "network";
  }
  if (NOT_FOUND_PATTERN.test(stderr)) {
    return "not_found";
  }
  return "failed";
};

const repoNameOf = (source: CloneSource) => {
  const raw = source.kind === "github" ? source.repo : source.url;
  const last = raw.replace(/\/+$/u, "").split(/[/:]/u).at(-1) ?? "repository";
  return last.replace(/\.git$/u, "") || "repository";
};

const lastLines = (text: string) =>
  redactUrl(text.trim().split("\n").slice(-3).join("\n")) || "Clone failed";

export const browseFolder = async (
  rawPath: string | undefined
): Promise<FsBrowseResponse> => {
  const dir = path.resolve(expandHome(rawPath || os.homedir()));
  let names: string[];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    names = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .toSorted((a, b) => a.localeCompare(b));
  } catch {
    throw badRequest("That folder cannot be opened");
  }
  const parent = path.dirname(dir);
  return {
    entries: names.map((name) => ({
      isGitRepo: existsSync(path.join(dir, name, ".git")),
      name,
      path: path.join(dir, name),
    })),
    parent: parent === dir ? null : parent,
    path: dir,
  };
};

export const githubAuth = async (): Promise<GithubAuthStatus> => {
  const host = "github.com";
  const result = await run("gh", ["auth", "status", "--hostname", host], {
    timeoutMs: 15_000,
  });
  if (result.missing) {
    return {
      host,
      message: "Install the GitHub CLI (gh) to clone from GitHub.",
      state: "gh_missing",
      user: null,
    };
  }
  if (!result.ok) {
    const text = `${result.stdout}\n${result.stderr}`;
    const signedOut = /not logged|no oauth token|gh auth login/iu.test(text);
    return {
      host,
      message: signedOut
        ? "Run `gh auth login` in a terminal, then check again."
        : lastLines(text),
      state: signedOut ? "signed_out" : "error",
      user: null,
    };
  }
  const user = await run("gh", ["api", "user", "--jq", ".login"], {
    timeoutMs: 15_000,
  });
  return {
    host,
    message: null,
    state: "signed_in",
    user: user.ok ? user.stdout.trim() : null,
  };
};

export const githubRepos = async (
  query: string | undefined
): Promise<GithubRepo[]> => {
  const auth = await githubAuth();
  if (auth.state !== "signed_in") {
    throw new AppError(
      "unauthorized",
      auth.message ?? "Sign in to GitHub first"
    );
  }
  const fields = "nameWithOwner,description,isPrivate,updatedAt";
  const result = query
    ? await run(
        "gh",
        ["search", "repos", query, "--limit", "50", "--json", fields],
        { timeoutMs: 30_000 }
      )
    : await run("gh", ["repo", "list", "--limit", "100", "--json", fields], {
        timeoutMs: 30_000,
      });
  if (!result.ok) {
    throw new AppError("unavailable", lastLines(result.stderr));
  }
  const parsed: unknown = JSON.parse(result.stdout || "[]");
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.map((item: Record<string, unknown>) => ({
    description:
      typeof item.description === "string" && item.description
        ? item.description
        : null,
    isPrivate: item.isPrivate === true,
    nameWithOwner: String(item.nameWithOwner ?? ""),
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : null,
  }));
};

export class ProjectService {
  readonly #store: Store;
  readonly #log: EventLog;
  readonly #journal: OperationJournal;
  readonly #reposDir: string;
  readonly #now: () => Date;

  constructor(options: ProjectServiceOptions) {
    this.#store = options.store;
    this.#log = options.log;
    this.#journal = options.journal;
    this.#reposDir = options.reposDir;
    this.#now = options.now ?? (() => new Date());
  }

  list() {
    return this.#store.listProjects();
  }

  get(id: string) {
    const project = this.#store.getProject(id);
    if (!project) {
      throw notFound("Project");
    }
    return project;
  }

  #save(project: Project) {
    this.#log.commit((emit) => {
      this.#store.putProject(project);
      emit(null, { data: { project }, type: "project.updated" });
    });
    return project;
  }

  async #describe(dir: string): Promise<Project> {
    const existing = this.#store.projectByPath(dir);
    const [defaultBranch, remoteUrl] = await Promise.all([
      repo.defaultBranch(dir),
      repo.remoteUrl(dir),
    ]);
    return {
      createdAt: existing?.createdAt ?? this.#now().toISOString(),
      defaultBranch,
      id: existing?.id ?? randomUUID(),
      kind: "git",
      name: path.basename(dir),
      path: dir,
      remoteUrl,
    };
  }

  async addLocal(
    input: AddLocalProjectRequest
  ): Promise<AddLocalProjectResponse> {
    const request = AddLocalProjectRequestSchema.parse(input);
    const dir = await repo.canonical(path.resolve(expandHome(request.path)));
    const info = dir ? await stat(dir) : null;
    if (!(dir && info?.isDirectory())) {
      throw badRequest("That folder does not exist");
    }
    const top = await repo.topLevel(dir);
    if (top) {
      return {
        project: this.#save(await this.#describe(top)),
        status: "added",
      };
    }
    if (!request.initializeGit) {
      return { path: dir, status: "not_git" };
    }
    await this.#journal.run(
      {
        detail: { path: dir },
        id: request.operationId,
        kind: "project.git_init",
        missionId: null,
      },
      async () => {
        const result = await git(dir, ["init"]);
        if (!result.ok) {
          throw new AppError("internal", "git init failed");
        }
        return { path: dir };
      }
    );
    return { project: this.#save(await this.#describe(dir)), status: "added" };
  }

  /** Forgets the project; never touches files on disk. */
  remove(id: string) {
    this.get(id);
    const active = this.#store
      .listMissions(id)
      .some(
        (mission) =>
          !["completed", "failed", "archived"].includes(mission.status)
      );
    if (active) {
      throw new AppError(
        "conflict",
        "Finish or archive this project's missions first"
      );
    }
    this.#log.commit((emit) => {
      this.#store.deleteProject(id);
      emit(null, { data: { projectId: id }, type: "project.removed" });
    });
  }

  #saveJob(job: CloneJob) {
    this.#log.commit((emit) => {
      this.#store.putCloneJob(job);
      emit(null, { data: { job }, type: "clone.updated" });
    });
    return job;
  }

  getCloneJob(id: string) {
    const job = this.#store.getCloneJob(id);
    if (!job) {
      throw notFound("Clone job");
    }
    return job;
  }

  /** Starts a clone in the background; progress arrives as clone.updated events. */
  async clone(request: CloneProjectRequest): Promise<CloneJob> {
    const existing = this.#store.getOperation(request.operationId);
    if (existing && existing.operation.kind === "project.clone") {
      const { jobId } = existing.operation.detail;
      return this.getCloneJob(typeof jobId === "string" ? jobId : "");
    }
    const parent = path.resolve(
      expandHome(request.destinationParent ?? this.#reposDir)
    );
    const destination = path.join(parent, repoNameOf(request.source));
    const job: CloneJob = {
      createdAt: this.#now().toISOString(),
      destination,
      error: null,
      id: randomUUID(),
      progress: null,
      projectId: null,
      source:
        request.source.kind === "url"
          ? { kind: "url", url: redactUrl(request.source.url) }
          : request.source,
      status: "cloning",
    };
    if (existsSync(destination)) {
      return this.#saveJob({
        ...job,
        error: {
          code: "destination_exists",
          message: `${destination} already exists. Add it as a local project or choose another folder.`,
        },
        status: "failed",
      });
    }
    await mkdir(parent, { recursive: true });
    this.#saveJob(job);
    void this.#journal
      .run(
        {
          detail: { destination, jobId: job.id },
          id: request.operationId,
          kind: "project.clone",
          missionId: null,
        },
        () => this.#runClone(job, request.source)
      )
      .catch(() => {
        // The job record carries the failure for the UI.
      });
    return job;
  }

  async #runClone(job: CloneJob, source: CloneSource) {
    let lastProgress = 0;
    const onStderrLine = (line: string) => {
      const now = Date.now();
      if (now - lastProgress >= PROGRESS_THROTTLE_MS) {
        lastProgress = now;
        this.#saveJob({ ...job, progress: redactUrl(line) });
      }
    };
    const result =
      source.kind === "github"
        ? await run(
            "gh",
            ["repo", "clone", source.repo, job.destination, "--", "--progress"],
            {
              onStderrLine,
              timeoutMs: 30 * 60_000,
            }
          )
        : await run(
            "git",
            ["clone", "--progress", "--", source.url, job.destination],
            {
              onStderrLine,
              timeoutMs: 30 * 60_000,
            }
          );
    if (!result.ok) {
      // Only the folder this job created is removed.
      await rm(job.destination, { force: true, recursive: true });
      const code: CloneErrorCode = result.missing
        ? "gh_missing"
        : classifyCloneError(result.stderr);
      this.#saveJob({
        ...job,
        error: {
          code,
          message: result.missing
            ? "GitHub CLI (gh) is not installed"
            : lastLines(result.stderr),
        },
        progress: null,
        status: "failed",
      });
      throw new AppError("bad_request", "Clone failed");
    }
    const project = this.#save(
      await this.#describe(
        (await repo.canonical(job.destination)) ?? job.destination
      )
    );
    this.#saveJob({
      ...job,
      progress: null,
      projectId: project.id,
      status: "succeeded",
    });
    return { projectId: project.id };
  }

  /** Clones interrupted by a daemon restart are reported, not resumed. */
  recoverCloneJobs() {
    for (const job of this.#store.listCloneJobs("cloning")) {
      this.#saveJob({
        ...job,
        error: {
          code: "failed",
          message: `The daemon stopped during this clone. Check ${job.destination} before retrying.`,
        },
        progress: null,
        status: "failed",
      });
    }
  }

  branches(id: string) {
    return repo.branches(this.get(id).path);
  }

  worktrees(id: string) {
    return repo.worktrees(this.get(id).path);
  }

  async checkout(id: string): Promise<CheckoutStatus> {
    const project = this.get(id);
    const [branch, entries] = await Promise.all([
      repo.currentBranch(project.path),
      repo.status(project.path),
    ]);
    const dirtyFiles = (entries ?? []).map((entry) => entry.path);
    return {
      branch,
      dirty: dirtyFiles.length > 0,
      dirtyFiles,
      path: project.path,
    };
  }
}
