import type {
  CleanupRequest,
  CommitRequest,
  CreatePullRequest,
  PushRequest,
} from "@missions/protocol/commands";
import {
  CleanupRequestSchema,
  CommitRequestSchema,
} from "@missions/protocol/commands";
import type {
  Mission,
  MissionStatus,
  PullRequestState,
} from "@missions/protocol/missions";
import type { WorkspaceBinding } from "@missions/protocol/workspaces";
import { WorkspaceBindingSchema } from "@missions/protocol/workspaces";

import type { OperationJournal } from "../db/journal";
import {
  captureReview,
  checkedGit,
  reviewedTree,
} from "../files/review-snapshot";
import { workspaceChanges } from "../files/workspace-files";
import { AppError, conflict, stale } from "../lib/app-error";
import { git, redactUrl, run } from "../lib/exec";
import type { MissionService } from "../missions/mission-service";
import type { SettingsService } from "../settings/settings-service";
import {
  cleanupBinding,
  planCleanup,
  verifyBinding,
} from "../workspaces/workspace-service";
import { observeCleanup } from "./cleanup-recovery";
import * as repo from "./repo";
import { createReviewedCandidate } from "./reviewed-candidate";
import {
  installReviewedCommit,
  repairReviewedIndex,
  ReviewedCommitIntentSchema,
  ReviewedCommitResultSchema,
} from "./reviewed-commit";
import type { ReviewedCommitIntent } from "./reviewed-commit";

export interface GitServiceOptions {
  missions: MissionService;
  journal: OperationJournal;
  settings: SettingsService;
  ghPath?: string;
  now?: () => Date;
  /** Bounds each git/gh call; exceeding it leaves the outcome unknown. */
  timeoutMs?: number;
}

/** Agents must be stopped before the user publishes, so nothing races the review. */
const PUBLISHABLE: ReadonlySet<MissionStatus> = new Set([
  "completed",
  "paused",
  "interrupted",
  "failed",
]);

/** Errors other than AppError (timeouts, crashes) may have taken effect remotely. */
const outcomeUnknown = (error: unknown) => !(error instanceof AppError);

const firstLine = (text: string) => text.trim().split("\n")[0] ?? "";

const pathIsLocal = (remote: string) =>
  remote.startsWith("/") || remote.startsWith(".");

/** gh's repository selector is not an SSH clone URL. */
export const githubRepository = (remote: string) => {
  const scp = /^(?:[^/@]+@)?(?<host>[^/:]+):(?<repo>[^/].*)$/u.exec(remote);
  if (scp?.groups && !pathIsLocal(remote)) {
    return `${scp.groups.host}/${scp.groups.repo?.replace(/\.git$/u, "")}`;
  }
  try {
    const url = new URL(remote);
    return `${url.host}/${url.pathname.replace(/^\/+/u, "").replace(/\.git$/u, "")}`;
  } catch {
    return remote;
  }
};

const failure = (stderr: string, fallback: string) => {
  const line = stderr
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(-3)
    .join(" ");
  return redactUrl(line || fallback);
};

interface GhPr {
  number: number;
  url: string;
  state: string;
  isDraft: boolean;
  updatedAt: string;
  headRefOid?: string;
  headRefName?: string;
  baseRefName?: string;
  isCrossRepository?: boolean;
  statusCheckRollup?: {
    status?: string;
    conclusion?: string;
    state?: string;
  }[];
}

const FAILING = new Set([
  "FAILURE",
  "ERROR",
  "CANCELLED",
  "TIMED_OUT",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
]);

export const checksOf = (
  rollup: GhPr["statusCheckRollup"]
): PullRequestState["checks"] => {
  if (!rollup || rollup.length === 0) {
    return "none";
  }
  const outcomes = rollup.map((check) =>
    (check.conclusion ?? check.state ?? "").toUpperCase()
  );
  if (outcomes.some((outcome) => FAILING.has(outcome))) {
    return "failing";
  }
  const pending = rollup.some(
    (check, index) =>
      (check.status && check.status.toUpperCase() !== "COMPLETED") ||
      outcomes[index] === "PENDING" ||
      outcomes[index] === ""
  );
  return pending ? "pending" : "passing";
};

const prState = (pr: GhPr): PullRequestState => {
  const state = pr.state.toUpperCase();
  let mapped: PullRequestState["state"] = "open";
  if (state === "MERGED") {
    mapped = "merged";
  } else if (state === "CLOSED") {
    mapped = "closed";
  }
  return {
    checks: checksOf(pr.statusCheckRollup),
    isDraft: pr.isDraft,
    number: pr.number,
    state: mapped,
    updatedAt: new Date(pr.updatedAt).toISOString(),
    url: pr.url,
  };
};

const PR_FIELDS =
  "number,url,state,isDraft,updatedAt,headRefOid,headRefName,baseRefName,isCrossRepository,statusCheckRollup";

/**
 * The reviewed publish lifecycle: commit, push, draft PR, status refresh and
 * safe cleanup. Every effect is journaled; an unknown outcome is reconciled
 * against git or GitHub before anything is attempted again.
 */
export class GitService {
  readonly #missions: MissionService;
  readonly #journal: OperationJournal;
  readonly #settings: SettingsService;
  readonly #gh: string;
  readonly #timeoutMs: number;

  constructor(options: GitServiceOptions) {
    this.#missions = options.missions;
    this.#journal = options.journal;
    this.#settings = options.settings;
    this.#gh = options.ghPath ?? "gh";
    this.#timeoutMs = options.timeoutMs ?? 120_000;
  }

  #binding(missionId: string): { mission: Mission; binding: WorkspaceBinding } {
    const mission = this.#missions.get(missionId);
    if (!mission.workspace) {
      throw conflict("The mission has no folder");
    }
    if (!PUBLISHABLE.has(mission.status)) {
      throw conflict(
        mission.status === "stop_failed"
          ? "Agent processes may still be running; resolve that first"
          : "Pause the mission or wait for it to finish before publishing"
      );
    }
    return { binding: mission.workspace, mission };
  }

  async #git(binding: WorkspaceBinding, args: string[]) {
    const result = await git(binding.path, args, {
      timeoutMs: this.#timeoutMs,
    });
    if (result.code === null && !result.missing) {
      throw new Error(`git ${args[0] ?? ""} did not finish`);
    }
    return result;
  }

  async #ghJson<T>(binding: WorkspaceBinding, args: string[]): Promise<T> {
    const result = await run(this.#gh, args, {
      cwd: (await repo.canonical(binding.path)) ?? binding.repoRoot,
      timeoutMs: this.#timeoutMs,
    });
    if (result.missing) {
      throw conflict("Install the GitHub CLI (gh) to open pull requests");
    }
    if (result.code === null) {
      throw new Error(`gh ${args[0] ?? ""} did not finish`);
    }
    if (!result.ok) {
      const text = `${result.stdout}\n${result.stderr}`;
      if (/gh auth login|not logged/iu.test(text)) {
        throw new AppError(
          "unauthorized",
          "Run `gh auth login` in a terminal, then try again"
        );
      }
      throw conflict(failure(result.stderr, `gh ${args[0] ?? ""} failed`));
    }
    return JSON.parse(result.stdout || "null") as T;
  }

  async #verifiedBinding(missionId: string) {
    const value = this.#binding(missionId);
    const problems = await verifyBinding(value.binding);
    if (problems.length > 0) {
      throw conflict(problems.join("; "));
    }
    return value;
  }

  async #reconcile(
    operationId: string,
    kind: string,
    missionId: string,
    check: (detail: Record<string, unknown>) => Promise<unknown>
  ) {
    const existing = this.#journal.get(operationId, { kind, missionId });
    if (existing?.operation.status !== "unknown") {
      return existing;
    }
    // Missing evidence or failed lookups deliberately leave the outcome unknown.
    const result = await check(existing.operation.detail);
    if (result !== null) {
      this.#journal.reconcile(
        operationId,
        "reconciled",
        result,
        "Verified the recorded original intent"
      );
    }
    return this.#journal.get(operationId, { kind, missionId });
  }

  commit(missionId: string, input: CommitRequest): Promise<Mission> {
    return this.#missions.withWorkspaceMutation(missionId, () =>
      this.#commit(missionId, input)
    );
  }

  async #assertInstalled(
    binding: WorkspaceBinding,
    intent: ReviewedCommitIntent,
    sha: string
  ) {
    const [head, branch, tree] = await Promise.all([
      repo.head(binding.path),
      repo.currentBranch(binding.path),
      checkedGit(binding.path, ["rev-parse", `${sha}^{tree}`], {
        timeoutMs: this.#timeoutMs,
      }),
    ]).catch((error: unknown) => {
      throw new Error(
        "Could not verify the installed commit around post-commit",
        { cause: error }
      );
    });
    if (head !== sha || branch !== intent.branch || tree !== intent.tree) {
      throw new Error(
        "The real commit ref or approved tree changed around post-commit; review the repository before publishing"
      );
    }
  }

  /** Installation is durable before admission; uncertain external hooks are never retried. */
  async #finishCommit(
    missionId: string,
    binding: WorkspaceBinding,
    intent: ReviewedCommitIntent,
    sha: string
  ) {
    const identity = { kind: "git.post_commit", missionId };
    const existing = intent.postCommitId
      ? this.#journal.get(intent.postCommitId, identity)
      : null;
    if (existing) {
      if (
        existing.operation.detail.sha !== sha ||
        existing.operation.detail.tree !== intent.tree ||
        existing.operation.detail.branch !== intent.branch
      ) {
        throw conflict(
          "The recorded post-commit belongs to another approved commit"
        );
      }
      if (["intent", "unknown"].includes(existing.operation.status)) {
        throw new Error(
          "The post-commit hook outcome is unknown; it will not be run again automatically"
        );
      }
      // Admission proves the real index was installed. A post-commit hook may
      // subsequently stage unrelated bytes; recovery must not repair over them.
      return;
    }
    await repairReviewedIndex(binding.path, intent, sha);
    if (!intent.postCommitId) {
      return;
    }
    await this.#assertInstalled(binding, intent, sha);
    const index = await checkedGit(binding.path, [
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      "index",
    ]);
    let knownExit: Error | undefined;
    try {
      await this.#journal.run(
        {
          detail: { branch: intent.branch, sha, tree: intent.tree },
          id: intent.postCommitId,
          ...identity,
        },
        async () => {
          const result = await git(
            binding.path,
            ["hook", "run", "--ignore-missing", "post-commit"],
            {
              env: { GIT_EDITOR: ":", GIT_INDEX_FILE: index },
              timeoutMs: this.#timeoutMs,
            }
          );
          if (result.code === null || result.missing) {
            throw new Error(
              "The post-commit hook did not finish; its outcome is unknown"
            );
          }
          await this.#assertInstalled(binding, intent, sha);
          if (!result.ok) {
            knownExit = new Error(
              `The post-commit hook exited with code ${result.code}; the approved commit remains installed`
            );
            throw knownExit;
          }
          return { code: result.code };
        },
        {
          outcomeUnknown: (error) =>
            knownExit === undefined || error !== knownExit,
        }
      );
    } catch (error) {
      if (knownExit === undefined || error !== knownExit) {
        throw new TypeError(
          `The installed commit's post-commit outcome is unknown: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error }
        );
      }
      // Native Git does not undo or reject an installed commit for a known
      // post-commit nonzero exit. Its failure remains visible in the journal.
    }
  }

  async #commit(missionId: string, input: CommitRequest): Promise<Mission> {
    const request = CommitRequestSchema.parse(input);
    this.#journal.get(request.operationId, { kind: "git.commit", missionId });
    const { binding } = this.#binding(missionId);
    const existing = await this.#reconcile(
      request.operationId,
      "git.commit",
      missionId,
      async (detail) => {
        const intent = ReviewedCommitIntentSchema.safeParse(detail);
        const candidate = intent.success
          ? this.#journal.get(intent.data.candidateId, {
              kind: "git.commit_candidate",
              missionId,
            })
          : null;
        const recorded = ReviewedCommitResultSchema.safeParse(
          candidate?.result
        );
        let sha =
          typeof detail.approvedSha === "string" ? detail.approvedSha : null;
        let message = typeof detail.message === "string" ? detail.message : "";
        if (
          recorded.success &&
          candidate &&
          ["succeeded", "reconciled"].includes(candidate.operation.status)
        ) {
          ({ sha, message } = recorded.data);
        }
        if (!sha) {
          return null;
        }
        const contains = await this.#git(binding, [
          "merge-base",
          "--is-ancestor",
          sha,
          "HEAD",
        ]);
        if (contains.code !== 0 && contains.code !== 1) {
          throw new Error(
            "Could not determine whether the approved commit is present"
          );
        }
        if (!contains.ok) {
          return null;
        }
        if (intent.success) {
          const tree = await checkedGit(binding.path, [
            "rev-parse",
            `${sha}^{tree}`,
          ]);
          if (tree !== intent.data.tree) {
            throw conflict(
              "The recorded commit does not match the reviewed tree"
            );
          }
          await this.#finishCommit(missionId, binding, intent.data, sha);
        }
        return { message, sha };
      }
    );
    let installed = false;
    let effect: (
      intent: Record<string, unknown>
    ) => Promise<{ sha: string; message: string }> = () =>
      Promise.reject(
        conflict(`Operation ${request.operationId} has an unknown outcome`)
      );
    let detail: Record<string, unknown> = existing?.operation.detail ?? {};
    if (!existing) {
      await this.#verifiedBinding(missionId);
      const snapshot = await captureReview(binding);
      if (snapshot.branch !== binding.branch) {
        throw stale("The checked-out branch moved since review; review again");
      }
      if (snapshot.head !== request.expectedHead) {
        throw stale("HEAD moved since you reviewed the changes; review again");
      }
      if (snapshot.hash !== request.expectedChangesHash) {
        throw stale("The changes moved since you reviewed them; review again");
      }
      const changes = await workspaceChanges(binding, snapshot);
      const uncommitted = changes.files.filter((file) => !file.committed);
      const included = request.includePreExisting
        ? uncommitted
        : uncommitted.filter((file) => !file.preExisting);
      const paths = new Set(
        included.flatMap((file) =>
          file.oldPath ? [file.oldPath, file.path] : [file.path]
        )
      );
      const entries = snapshot.entries.filter(
        (entry) =>
          paths.has(entry.path) &&
          (request.includePreExisting ||
            !binding.baselineDirtyFiles.includes(entry.path))
      );
      if (entries.length === 0) {
        throw conflict(
          uncommitted.length > 0
            ? "Only files changed before the mission started remain. Review them and include them to commit."
            : "There is nothing to commit"
        );
      }
      const tree = await reviewedTree(binding.path, snapshot.head, entries);
      const previousTree = snapshot.head
        ? await checkedGit(binding.path, [
            "rev-parse",
            `${snapshot.head}^{tree}`,
          ])
        : null;
      if (tree === previousTree) {
        throw conflict("There is nothing to commit");
      }
      detail = {
        ...request,
        binding,
        branch: snapshot.branch,
        candidateId: `${request.operationId}:candidate`,
        entries,
        originalIndex: snapshot.index,
        postCommitId: `${request.operationId}:post-commit`,
        tree,
      };
      effect = async (recorded) => {
        const intent = ReviewedCommitIntentSchema.parse(recorded);
        const { result: candidate } = await this.#journal.run(
          {
            detail: intent,
            id: intent.candidateId,
            kind: "git.commit_candidate",
            missionId,
          },
          (candidateIntent) =>
            createReviewedCandidate(
              binding.path,
              ReviewedCommitIntentSchema.parse(candidateIntent)
            ),
          { outcomeUnknown }
        );
        await installReviewedCommit(
          binding.path,
          {
            branch: intent.branch,
            head: intent.expectedHead,
            index: intent.originalIndex,
          },
          intent.entries,
          candidate.sha
        );
        installed = true;
        await this.#finishCommit(missionId, binding, intent, candidate.sha);
        return candidate;
      };
    }
    const { result } = await this.#journal.run(
      { detail, id: request.operationId, kind: "git.commit", missionId },
      effect,
      // A later local validation error cannot mean that no commit was made.
      { outcomeUnknown: (error) => installed || outcomeUnknown(error) }
    );
    if (!result?.sha) {
      return this.#missions.get(missionId);
    }
    return this.#missions.patch(missionId, (mission) =>
      mission.publish.commits.some((commit) => commit.sha === result.sha)
        ? mission
        : {
            ...mission,
            publish: {
              ...mission.publish,
              commits: [
                ...mission.publish.commits,
                {
                  message: firstLine(
                    result.message ?? String(detail.message ?? "")
                  ),
                  sha: result.sha,
                },
              ],
            },
          }
    );
  }

  async #remoteHead(binding: WorkspaceBinding, branch: string, remote: string) {
    const target = await this.#remoteTarget(binding, remote);
    const result = await this.#git(binding, [
      "ls-remote",
      "--",
      target,
      `refs/heads/${branch}`,
    ]);
    if (!result.ok) {
      throw new Error("Could not determine the remote branch head");
    }
    return (
      result.stdout
        .split("\n")
        .find((line) => line.split(/\s/u)[1] === `refs/heads/${branch}`)
        ?.split(/\s/u)[0] ?? null
    );
  }

  async #remoteTarget(binding: WorkspaceBinding, identity: string) {
    const configured = await this.#git(binding, [
      "remote",
      "get-url",
      "origin",
    ]);
    if (!configured.ok || redactUrl(configured.stdout) !== identity) {
      throw new Error(
        "The origin remote identity changed; its original outcome is unknown"
      );
    }
    // Credentials remain local and transient, never in the journal or response.
    return configured.stdout;
  }

  async #trackPush(
    binding: WorkspaceBinding,
    branch: string,
    remote: string,
    sha: string
  ) {
    await this.#remoteTarget(binding, remote);
    await checkedGit(binding.path, [
      "show-ref",
      "--verify",
      `refs/heads/${branch}`,
    ]);
    await checkedGit(binding.path, [
      "update-ref",
      `refs/remotes/origin/${branch}`,
      sha,
    ]);
    await checkedGit(binding.path, [
      "config",
      "--local",
      "--replace-all",
      `branch.${branch}.remote`,
      "origin",
    ]);
    await checkedGit(binding.path, [
      "config",
      "--local",
      "--replace-all",
      `branch.${branch}.merge`,
      `refs/heads/${branch}`,
    ]);
  }

  push(missionId: string, request: PushRequest): Promise<Mission> {
    return this.#missions.withWorkspaceMutation(missionId, () =>
      this.#push(missionId, request)
    );
  }

  async #push(missionId: string, request: PushRequest): Promise<Mission> {
    this.#journal.get(request.operationId, { kind: "git.push", missionId });
    const { binding } = this.#binding(missionId);
    const existing = await this.#reconcile(
      request.operationId,
      "git.push",
      missionId,
      async (detail) => {
        if (
          typeof detail.branch !== "string" ||
          typeof detail.remote !== "string" ||
          typeof detail.expectedHead !== "string"
        ) {
          return null;
        }
        const remoteHead = await this.#remoteHead(
          binding,
          detail.branch,
          detail.remote
        );
        if (remoteHead !== detail.expectedHead) {
          return null;
        }
        await this.#trackPush(
          binding,
          detail.branch,
          detail.remote,
          detail.expectedHead
        );
        return { branch: detail.branch, remote: detail.remote };
      }
    );
    let detail = existing?.operation.detail ?? {};
    if (!existing) {
      await this.#verifiedBinding(missionId);
      const branch = await repo.currentBranch(binding.path);
      const remote = await repo.remoteUrl(binding.path);
      if (!branch) {
        throw conflict(
          "The mission folder is on a detached HEAD; check out a branch first"
        );
      }
      if (!remote) {
        throw conflict("The repository has no origin remote");
      }
      detail = { ...request, branch, remote };
    }
    const { result } = await this.#journal.run(
      { detail, id: request.operationId, kind: "git.push", missionId },
      async (intent) => {
        const branch = String(intent.branch);
        const remote = String(intent.remote);
        const approvedSha = String(intent.expectedHead);
        if ((await repo.head(binding.path)) !== approvedSha) {
          throw stale("HEAD moved since you approved the push; review again");
        }
        const target = await this.#remoteTarget(binding, remote);
        const pushed = await this.#git(binding, [
          "push",
          "--porcelain",
          "--",
          target,
          `${approvedSha}:refs/heads/${branch}`,
        ]);
        if (!pushed.ok) {
          if (
            /rejected|non-fast-forward|fetch first/iu.test(
              `${pushed.stdout}\\n${pushed.stderr}`
            )
          ) {
            this.#missions.notify(
              missionId,
              "merge_conflict",
              "error",
              `The remote ${branch} has commits you do not have. Pull or rebase in a terminal, then push again.`
            );
          }
          throw conflict(failure(pushed.stderr, "git push failed"));
        }
        try {
          await this.#trackPush(binding, branch, remote, approvedSha);
        } catch (error) {
          throw new Error(
            "The approved push succeeded but upstream tracking could not be settled",
            { cause: error }
          );
        }
        return { branch, remote };
      },
      { outcomeUnknown }
    );
    return this.#missions.patch(missionId, (mission) => ({
      ...mission,
      publish: {
        ...mission.publish,
        pushedBranch: result.branch,
        remote: result.remote,
      },
    }));
  }

  async #findPr(binding: WorkspaceBinding, intent: Record<string, unknown>) {
    const { branch, base, remote, expectedHead } = intent;
    if (
      typeof branch !== "string" ||
      typeof base !== "string" ||
      typeof remote !== "string" ||
      typeof expectedHead !== "string"
    ) {
      throw new TypeError("The recorded pull request intent is incomplete");
    }
    const prs = await this.#ghJson<GhPr[]>(binding, [
      "pr",
      "list",
      "--repo",
      githubRepository(remote),
      "--head",
      branch,
      "--base",
      base,
      "--state",
      "open",
      "--json",
      PR_FIELDS,
      "--limit",
      "100",
    ]);
    return (
      prs.find(
        (pr) =>
          pr.state.toUpperCase() === "OPEN" &&
          pr.headRefName === branch &&
          pr.baseRefName === base &&
          pr.headRefOid === expectedHead &&
          pr.isCrossRepository === false
      ) ?? null
    );
  }

  createPullRequest(
    missionId: string,
    request: CreatePullRequest
  ): Promise<Mission> {
    return this.#missions.withWorkspaceMutation(missionId, () =>
      this.#createPullRequest(missionId, request)
    );
  }

  async #createPullRequest(
    missionId: string,
    request: CreatePullRequest
  ): Promise<Mission> {
    this.#journal.get(request.operationId, { kind: "github.pr", missionId });
    const { binding, mission } = this.#binding(missionId);
    const existing = await this.#reconcile(
      request.operationId,
      "github.pr",
      missionId,
      async (detail) => await this.#findPr(binding, detail)
    );
    let detail = existing?.operation.detail ?? {};
    if (!existing) {
      await this.#verifiedBinding(missionId);
      const branch = mission.publish.pushedBranch;
      const { remote } = mission.publish;
      const base = binding.baseRef;
      if (!branch || !remote) {
        throw conflict("Push the branch before opening a pull request");
      }
      if (!base || branch === base) {
        throw conflict(
          "The mission needs a separate branch and a known base for a pull request"
        );
      }
      detail = { ...request, base, branch, remote };
    }
    const { result } = await this.#journal.run(
      { detail, id: request.operationId, kind: "github.pr", missionId },
      async (intent) => {
        const branch = String(intent.branch);
        const remote = String(intent.remote);
        const approvedSha = String(intent.expectedHead);
        if ((await repo.head(binding.path)) !== approvedSha) {
          throw stale(
            "HEAD moved since you reviewed the pull request; review again"
          );
        }
        const verifyRemote = async () => {
          if (
            (await this.#remoteHead(binding, branch, remote)) !== approvedSha
          ) {
            throw stale(
              "The remote branch moved since approval; push the reviewed head before opening a pull request"
            );
          }
        };
        await verifyRemote();
        const found = await this.#findPr(binding, intent);
        if (found) {
          return found;
        }
        await verifyRemote();
        const created = await run(
          this.#gh,
          [
            "pr",
            "create",
            "--repo",
            githubRepository(remote),
            "--draft",
            "--title",
            String(intent.title),
            "--body",
            String(intent.body),
            "--head",
            branch,
            "--base",
            String(intent.base),
          ],
          { cwd: binding.path, timeoutMs: this.#timeoutMs }
        );
        if (created.code === null) {
          throw new Error("gh pr create did not finish");
        }
        if (!created.ok) {
          throw conflict(failure(created.stderr, "gh pr create failed"));
        }
        const readBack = await this.#findPr(binding, intent);
        if (!readBack) {
          throw new Error(
            "The pull request was created but could not be read back"
          );
        }
        return readBack;
      },
      { outcomeUnknown }
    );
    return this.#missions.patch(missionId, (m) => ({
      ...m,
      publish: { ...m.publish, pr: prState(result) },
    }));
  }

  /**
   * Re-reads repository facts after an agent ran a Git or gh action: branch,
   * HEAD, commits since the mission started, upstream and an existing pull
   * request. Read-only and best effort; agents own these actions, the UI
   * only reflects what actually happened.
   */
  async observeAgentGit(missionId: string): Promise<Mission> {
    const mission = this.#missions.get(missionId);
    const binding = mission.workspace;
    if (!binding) {
      return mission;
    }
    const commits = binding.startRevision
      ? await this.#commitsSince(binding, binding.startRevision)
      : null;
    const upstream = await this.#upstream(binding);
    const pr = upstream ? await this.#observedPr(binding, upstream) : null;
    return this.#missions.patch(missionId, (m) => ({
      ...m,
      publish: {
        ...m.publish,
        commits: commits ?? m.publish.commits,
        pr: pr ?? m.publish.pr,
        pushedBranch: upstream?.branch ?? m.publish.pushedBranch,
        remote: upstream?.remote ?? m.publish.remote,
      },
    }));
  }

  async #commitsSince(binding: WorkspaceBinding, start: string) {
    const result = await git(
      binding.path,
      ["log", "--reverse", "--format=%H%x1f%s", `${start}..HEAD`],
      { timeoutMs: this.#timeoutMs }
    );
    if (!result.ok) {
      return null;
    }
    return result.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha = "", message = ""] = line.split("\u001F");
        return { message, sha };
      });
  }

  async #upstream(binding: WorkspaceBinding) {
    const result = await git(
      binding.path,
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
      { timeoutMs: this.#timeoutMs }
    );
    const ref = result.ok ? result.stdout.trim() : "";
    const slash = ref.indexOf("/");
    if (slash <= 0) {
      return null;
    }
    const remoteName = ref.slice(0, slash);
    const url = await git(binding.path, ["remote", "get-url", remoteName], {
      timeoutMs: this.#timeoutMs,
    });
    if (!url.ok) {
      return null;
    }
    return {
      branch: ref.slice(slash + 1),
      remote: redactUrl(url.stdout.trim()),
    };
  }

  async #observedPr(
    binding: WorkspaceBinding,
    upstream: { branch: string; remote: string }
  ) {
    try {
      const prs = await this.#ghJson<GhPr[]>(binding, [
        "pr",
        "list",
        "--repo",
        githubRepository(upstream.remote),
        "--head",
        upstream.branch,
        "--state",
        "all",
        "--json",
        PR_FIELDS,
        "--limit",
        "1",
      ]);
      const [found] = prs ?? [];
      return found ? prState(found) : null;
    } catch {
      // gh missing, signed out or offline: keep the last known PR state.
      return null;
    }
  }

  async refreshPullRequest(missionId: string): Promise<Mission> {
    const mission = this.#missions.get(missionId);
    const { pr } = mission.publish;
    if (!(pr && mission.workspace)) {
      return mission;
    }
    const view = await this.#ghJson<GhPr>(mission.workspace, [
      "pr",
      "view",
      String(pr.number),
      ...(mission.publish.remote
        ? ["--repo", githubRepository(mission.publish.remote)]
        : []),
      "--json",
      PR_FIELDS,
    ]);
    const next = prState(view);
    const updated = this.#missions.patch(missionId, (m) => ({
      ...m,
      publish: {
        ...m.publish,
        cleanup:
          next.state === "merged" && m.publish.cleanup === "none"
            ? "eligible"
            : m.publish.cleanup,
        pr: next,
      },
    }));
    if (
      next.state !== "merged" ||
      !this.#settings.get().cleanupAfterMerge ||
      !updated.workspace?.owned ||
      updated.publish.cleanup !== "eligible"
    ) {
      return updated;
    }
    // Refresh itself remains readable while agents run; only the destructive
    // transition requires the stopped-workspace interval.
    try {
      return await this.cleanup(missionId, {
        action: "remove",
        operationId: `auto-cleanup:${missionId}:${pr.number}:${view.headRefOid ?? "unknown"}`,
      });
    } catch (error) {
      if (error instanceof AppError && error.code === "conflict") {
        return this.#missions.get(missionId);
      }
      throw error;
    }
  }

  async #removeWorkspace(
    missionId: string,
    mergedHead: string | null,
    expectedHead?: string | null,
    allowBranchDeletion?: boolean
  ) {
    const mission = this.#missions.get(missionId);
    if (!mission.workspace) {
      return mission;
    }
    const outcome = await cleanupBinding(mission.workspace, {
      allowBranchDeletion,
      deleteBranch: true,
      expectedHead,
      mergedHead,
    });
    return this.#missions.patch(missionId, (m) => ({
      ...m,
      publish: {
        ...m.publish,
        cleanup: outcome.removed ? "removed" : "blocked",
        cleanupReason: outcome.reason,
      },
      status: outcome.removed ? "archived" : m.status,
    }));
  }

  cleanup(missionId: string, input: CleanupRequest): Promise<Mission> {
    const existing = this.#journal.get(input.operationId, {
      kind: "workspace.cleanup",
      missionId,
    });
    const mission = this.#missions.get(missionId);
    if (
      existing &&
      ["succeeded", "reconciled"].includes(existing.operation.status) &&
      mission.publish.cleanup === "removed"
    ) {
      // A terminal replay is a read, not a new mutation of a removed folder.
      return Promise.resolve(mission);
    }
    if (existing && ["intent", "unknown"].includes(existing.operation.status)) {
      return this.#missions.withWorkspaceRecovery(
        missionId,
        input.operationId,
        () => this.#recoverCleanup(missionId, input.operationId)
      );
    }
    return this.#missions.withWorkspaceMutation(missionId, () =>
      this.#cleanup(missionId, input)
    );
  }

  async #recoverCleanup(
    missionId: string,
    operationId: string
  ): Promise<Mission> {
    const recorded = this.#journal.get(operationId, {
      kind: "workspace.cleanup",
      missionId,
    });
    if (
      !recorded ||
      !["intent", "unknown"].includes(recorded.operation.status)
    ) {
      throw conflict("Only an uncertain original cleanup can be reconciled");
    }
    const mission = this.#missions.get(missionId);
    const original = WorkspaceBindingSchema.parse(
      recorded.operation.detail.binding
    );
    if (
      !mission.workspace ||
      original.id !== mission.workspace.id ||
      original.path !== mission.workspace.path ||
      original.repoRoot !== mission.workspace.repoRoot ||
      original.branch !== mission.workspace.branch
    ) {
      throw conflict(
        "The workspace binding changed after the original cleanup intent"
      );
    }
    if (recorded.operation.detail.action === "keep") {
      if (mission.publish.cleanup !== "kept") {
        throw conflict("The original keep outcome cannot be verified");
      }
      this.#journal.reconcile(
        operationId,
        "reconciled",
        mission,
        "Observed the original keep outcome"
      );
      return mission;
    }
    const observed = await observeCleanup(recorded.operation.detail);
    const updated =
      mission.status === "archived" && mission.publish.cleanup === "removed"
        ? mission
        : this.#missions.patch(missionId, (m) => ({
            ...m,
            publish: {
              ...m.publish,
              cleanup: "removed",
              cleanupReason: observed.reason,
            },
            status: "archived",
          }));
    this.#journal.reconcile(
      operationId,
      "reconciled",
      updated,
      "Verified the original worktree registration and exact branch outcome"
    );
    return updated;
  }

  async #cleanup(
    missionId: string,
    input: CleanupRequest,
    knownMergedHead?: string | null
  ): Promise<Mission> {
    const request = CleanupRequestSchema.parse(input);
    this.#journal.get(request.operationId, {
      kind: "workspace.cleanup",
      missionId,
    });
    const { binding, mission } = this.#binding(missionId);
    const existing = this.#journal.get(request.operationId, {
      kind: "workspace.cleanup",
      missionId,
    });
    let detail = existing?.operation.detail ?? {};
    if (!existing) {
      const mergedHead =
        knownMergedHead === undefined && mission.publish.pr?.state === "merged"
          ? await this.#mergedHead(mission)
          : (knownMergedHead ?? null);
      const plan =
        request.action === "remove"
          ? await planCleanup(binding, mergedHead)
          : {};
      detail = { ...request, binding, ...plan, mergedHead };
    }
    const { result } = await this.#journal.run(
      {
        detail,
        id: request.operationId,
        kind: "workspace.cleanup",
        missionId,
      },
      async (intent) => {
        if (intent.alwaysAfterMerge) {
          this.#settings.update({ cleanupAfterMerge: true });
        }
        if (intent.action === "keep") {
          return this.#missions.patch(missionId, (m) => ({
            ...m,
            publish: { ...m.publish, cleanup: "kept", cleanupReason: null },
          }));
        }
        const blockedReason = intent.cleanupBlockedReason;
        if (typeof blockedReason === "string") {
          return this.#missions.patch(missionId, (m) => ({
            ...m,
            publish: {
              ...m.publish,
              cleanup: "blocked",
              cleanupReason: blockedReason,
            },
          }));
        }
        const original = WorkspaceBindingSchema.parse(intent.binding);
        if (
          original.id !== binding.id ||
          original.path !== binding.path ||
          original.repoRoot !== binding.repoRoot
        ) {
          throw conflict(
            "The workspace binding changed after cleanup was approved"
          );
        }
        return await this.#removeWorkspace(
          missionId,
          typeof intent.mergedHead === "string" ? intent.mergedHead : null,
          typeof intent.expectedHead === "string" ? intent.expectedHead : null,
          intent.branchDeletionExpected === true
        );
      },
      { outcomeUnknown }
    );
    return result;
  }

  async #mergedHead(mission: Mission) {
    if (!(mission.publish.pr && mission.workspace)) {
      return null;
    }
    const view = await this.#ghJson<GhPr>(mission.workspace, [
      "pr",
      "view",
      String(mission.publish.pr.number),
      ...(mission.publish.remote
        ? ["--repo", githubRepository(mission.publish.remote)]
        : []),
      "--json",
      "headRefOid,state",
    ]);
    return view.state.toUpperCase() === "MERGED"
      ? (view.headRefOid ?? null)
      : null;
  }
}
