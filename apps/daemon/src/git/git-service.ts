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

import type { OperationJournal } from "../db/journal";
import { workspaceChanges } from "../files/workspace-files";
import { AppError, conflict, stale } from "../lib/app-error";
import { git, redactUrl, run } from "../lib/exec";
import type { MissionService } from "../missions/mission-service";
import type { SettingsService } from "../settings/settings-service";
import { cleanupBinding } from "../workspaces/workspace-service";
import * as repo from "./repo";

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
  "number,url,state,isDraft,updatedAt,headRefOid,statusCheckRollup";

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
      cwd: binding.path,
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

  /** A repeated operation whose outcome is unknown is checked, never re-run blindly. */
  async #reconcileIfUnknown(
    operationId: string,
    check: () => Promise<{ done: boolean; result: unknown; note: string }>
  ) {
    const existing = this.#journal.get(operationId);
    if (existing?.operation.status !== "unknown") {
      return;
    }
    const outcome = await check();
    this.#journal.reconcile(
      operationId,
      outcome.done ? "reconciled" : "failed",
      outcome.result,
      outcome.note
    );
  }

  // ------------------------------------------------------------------ commit

  async commit(missionId: string, input: CommitRequest): Promise<Mission> {
    const request = CommitRequestSchema.parse(input);
    const { binding } = this.#binding(missionId);
    await this.#reconcileIfUnknown(request.operationId, async () => {
      const [currentHead, parent, subject] = await Promise.all([
        repo.head(binding.path),
        this.#git(binding, ["rev-parse", "--verify", "--quiet", "HEAD^"]),
        this.#git(binding, ["log", "-1", "--format=%s"]),
      ]);
      const done =
        parent.stdout.trim() === request.expectedHead &&
        subject.stdout.trim() === firstLine(request.message);
      return {
        done,
        note: done ? "Found the commit at HEAD" : "No matching commit at HEAD",
        result: done ? { sha: currentHead } : null,
      };
    });
    const { result, duplicate } = await this.#journal.run(
      {
        detail: { expectedHead: request.expectedHead },
        id: request.operationId,
        kind: "git.commit",
        missionId,
      },
      async () => {
        const currentHead = await repo.head(binding.path);
        if (currentHead !== request.expectedHead) {
          throw stale(
            "HEAD moved since you reviewed the changes; review again"
          );
        }
        const changes = await workspaceChanges(binding);
        if (changes.hash !== request.expectedChangesHash) {
          throw stale(
            "The changes moved since you reviewed them; review again"
          );
        }
        const preExisting = changes.files.filter(
          (file) => file.preExisting && !file.committed
        );
        if (preExisting.length > 0 && !request.includePreExisting) {
          throw conflict(
            `Some files had changes before the mission started (${preExisting.map((file) => file.path).join(", ")}). Review them and confirm to include them.`
          );
        }
        const paths = changes.files
          .filter((file) => !file.committed)
          .flatMap((file) =>
            file.oldPath ? [file.oldPath, file.path] : [file.path]
          );
        if (paths.length === 0) {
          throw conflict("There is nothing to commit");
        }
        const added = await this.#git(binding, ["add", "-A", "--", ...paths]);
        if (!added.ok) {
          throw conflict(failure(added.stderr, "git add failed"));
        }
        const committed = await this.#git(binding, [
          "commit",
          "-q",
          "-m",
          request.message,
          "--",
          ...paths,
        ]);
        if (!committed.ok) {
          throw conflict(
            failure(committed.stderr || committed.stdout, "git commit failed")
          );
        }
        return { sha: await repo.head(binding.path) };
      },
      { outcomeUnknown }
    );
    const sha = (result as { sha: string | null } | null)?.sha;
    if (!sha) {
      return this.#missions.get(missionId);
    }
    return this.#missions.patch(missionId, (mission) =>
      duplicate && mission.publish.commits.some((commit) => commit.sha === sha)
        ? mission
        : {
            ...mission,
            publish: {
              ...mission.publish,
              commits: [
                ...mission.publish.commits,
                { message: firstLine(request.message), sha },
              ],
            },
          }
    );
  }

  // -------------------------------------------------------------------- push

  async #remoteHead(binding: WorkspaceBinding, branch: string) {
    const result = await this.#git(binding, [
      "ls-remote",
      "origin",
      `refs/heads/${branch}`,
    ]);
    return result.ok ? (result.stdout.split(/\s/u)[0] ?? null) || null : null;
  }

  async push(missionId: string, request: PushRequest): Promise<Mission> {
    const { binding } = this.#binding(missionId);
    const branch = await repo.currentBranch(binding.path);
    if (!branch) {
      throw conflict(
        "The mission folder is on a detached HEAD; check out a branch first"
      );
    }
    if (binding.branch && branch !== binding.branch) {
      throw conflict(`Expected branch ${binding.branch}, found ${branch}`);
    }
    const remote = await repo.remoteUrl(binding.path);
    if (!remote) {
      throw conflict("The repository has no origin remote");
    }
    await this.#reconcileIfUnknown(request.operationId, async () => {
      const remoteHead = await this.#remoteHead(binding, branch);
      const done = remoteHead === request.expectedHead;
      return {
        done,
        note: done
          ? "Remote branch is at the reviewed head"
          : `Remote branch is at ${remoteHead ?? "nothing"}`,
        result: done ? { branch } : null,
      };
    });
    const { result } = await this.#journal.run(
      {
        detail: { branch, expectedHead: request.expectedHead },
        id: request.operationId,
        kind: "git.push",
        missionId,
      },
      async () => {
        if ((await repo.head(binding.path)) !== request.expectedHead) {
          throw stale("HEAD moved since you approved the push; review again");
        }
        const pushed = await this.#git(binding, [
          "push",
          "--porcelain",
          "-u",
          "origin",
          `HEAD:refs/heads/${branch}`,
        ]);
        if (!pushed.ok) {
          const text = `${pushed.stdout}\n${pushed.stderr}`;
          if (/rejected|non-fast-forward|fetch first/iu.test(text)) {
            this.#missions.notify(
              missionId,
              "merge_conflict",
              "error",
              `The remote ${branch} has commits you do not have. Pull or rebase in a terminal, then push again.`
            );
            throw conflict(
              "The remote branch has new commits; integrate them before pushing"
            );
          }
          throw conflict(failure(pushed.stderr, "git push failed"));
        }
        return { branch };
      },
      { outcomeUnknown }
    );
    if (!result) {
      return this.#missions.get(missionId);
    }
    return this.#missions.patch(missionId, (mission) => ({
      ...mission,
      publish: { ...mission.publish, pushedBranch: branch, remote },
    }));
  }

  // ------------------------------------------------------------ pull request

  async #findPr(binding: WorkspaceBinding, branch: string) {
    const prs = await this.#ghJson<GhPr[]>(binding, [
      "pr",
      "list",
      "--head",
      branch,
      "--state",
      "all",
      "--json",
      PR_FIELDS,
      "--limit",
      "5",
    ]);
    return (
      prs.find((pr) => pr.state.toUpperCase() === "OPEN") ?? prs[0] ?? null
    );
  }

  async createPullRequest(
    missionId: string,
    request: CreatePullRequest
  ): Promise<Mission> {
    const { binding, mission } = this.#binding(missionId);
    const branch = mission.publish.pushedBranch;
    if (!branch) {
      throw conflict("Push the branch before opening a pull request");
    }
    await this.#reconcileIfUnknown(request.operationId, async () => {
      const found = await this.#findPr(binding, branch);
      return {
        done: found !== null,
        note: found ? `Found PR #${found.number}` : "No PR for the branch",
        result: found,
      };
    });
    const { result } = await this.#journal.run(
      {
        detail: { branch },
        id: request.operationId,
        kind: "github.pr",
        missionId,
      },
      async () => {
        if ((await repo.head(binding.path)) !== request.expectedHead) {
          throw stale(
            "HEAD moved since you reviewed the pull request; review again"
          );
        }
        // Adopting an existing PR keeps retries and parallel tabs from opening duplicates.
        const existing = await this.#findPr(binding, branch);
        if (existing && existing.state.toUpperCase() === "OPEN") {
          return existing;
        }
        const args = [
          "pr",
          "create",
          "--draft",
          "--title",
          request.title,
          "--body",
          request.body,
          "--head",
          branch,
        ];
        if (binding.baseRef) {
          args.push("--base", binding.baseRef);
        }
        const created = await run(this.#gh, args, {
          cwd: binding.path,
          timeoutMs: this.#timeoutMs,
        });
        if (created.code === null) {
          throw new Error("gh pr create did not finish");
        }
        if (!created.ok) {
          throw conflict(failure(created.stderr, "gh pr create failed"));
        }
        const found = await this.#findPr(binding, branch);
        if (!found) {
          throw new Error(
            "The pull request was created but could not be read back"
          );
        }
        return found;
      },
      { outcomeUnknown }
    );
    if (!result) {
      return this.#missions.get(missionId);
    }
    return this.#missions.patch(missionId, (m) => ({
      ...m,
      publish: { ...m.publish, pr: prState(result as GhPr) },
    }));
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
      "--json",
      PR_FIELDS,
    ]);
    const next = prState(view);
    const mergedNow = next.state === "merged" && pr.state !== "merged";
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
      mergedNow &&
      this.#settings.get().cleanupAfterMerge &&
      updated.workspace?.owned
    ) {
      return await this.#removeWorkspace(missionId, view.headRefOid ?? null);
    }
    return updated;
  }

  // ----------------------------------------------------------------- cleanup

  async #removeWorkspace(missionId: string, mergedHead: string | null) {
    const mission = this.#missions.get(missionId);
    if (!mission.workspace) {
      return mission;
    }
    const outcome = await cleanupBinding(mission.workspace, {
      deleteBranch: true,
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

  async cleanup(missionId: string, input: CleanupRequest): Promise<Mission> {
    const request = CleanupRequestSchema.parse(input);
    this.#binding(missionId);
    const { result } = await this.#journal.run(
      {
        detail: { action: request.action },
        id: request.operationId,
        kind: "workspace.cleanup",
        missionId,
      },
      async () => {
        if (request.alwaysAfterMerge) {
          this.#settings.update({ cleanupAfterMerge: true });
        }
        if (request.action === "keep") {
          return this.#missions.patch(missionId, (m) => ({
            ...m,
            publish: { ...m.publish, cleanup: "kept", cleanupReason: null },
          }));
        }
        const mission = this.#missions.get(missionId);
        const mergedHead =
          mission.publish.pr?.state === "merged"
            ? await this.#mergedHead(mission)
            : null;
        return await this.#removeWorkspace(missionId, mergedHead);
      }
    );
    return result ?? this.#missions.get(missionId);
  }

  async #mergedHead(mission: Mission) {
    if (!(mission.publish.pr && mission.workspace)) {
      return null;
    }
    try {
      const view = await this.#ghJson<GhPr>(mission.workspace, [
        "pr",
        "view",
        String(mission.publish.pr.number),
        "--json",
        "headRefOid",
      ]);
      return view.headRefOid ?? null;
    } catch {
      return null;
    }
  }
}
