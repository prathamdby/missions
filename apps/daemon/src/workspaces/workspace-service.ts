import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import type { Project } from "@missions/protocol/projects";
import type { Settings } from "@missions/protocol/settings";
import type {
  WorkspaceBinding,
  WorkspaceRequest,
} from "@missions/protocol/workspaces";
import { WorkspaceRequestSchema } from "@missions/protocol/workspaces";

import type { OperationJournal } from "../db/journal";
import * as repo from "../git/repo";
import { AppError, badRequest, conflict } from "../lib/app-error";
import { git } from "../lib/exec";

export interface WorkspaceServiceOptions {
  journal: OperationJournal;
  settings: () => Settings;
  now?: () => Date;
}

export interface CleanupOptions {
  deleteBranch: boolean;
  allowBranchDeletion?: boolean;
  expectedHead?: string | null;
  /** Head of a remotely merged PR; allows deleting a squash-merged branch at that exact head. */
  mergedHead?: string | null;
}

export interface CleanupResult {
  removed: boolean;
  branchDeleted: boolean;
  reason: string | null;
}

const SLUG_LIMIT = 40;

export const slugify = (text: string) =>
  text
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .slice(0, SLUG_LIMIT)
    .replace(/-+$/u, "") || "mission";

const missionSuffix = (missionId: string) =>
  missionId.replaceAll("-", "").slice(0, 6);

const VALID_BRANCH = /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)[\w./-]+(?<![./])$/u;

/**
 * Chooses and validates the one directory every agent in a mission shares.
 * Never stashes, resets, or discards user changes; only app-owned clean
 * worktrees are ever removed.
 */
export class WorkspaceService {
  readonly #journal: OperationJournal;
  readonly #settings: () => Settings;
  readonly #now: () => Date;

  constructor(options: WorkspaceServiceOptions) {
    this.#journal = options.journal;
    this.#settings = options.settings;
    this.#now = options.now ?? (() => new Date());
  }

  async bind(
    missionId: string,
    project: Project,
    input: WorkspaceRequest,
    operationId: string,
    title: string
  ): Promise<WorkspaceBinding> {
    const request = WorkspaceRequestSchema.parse(input);
    const repoRoot = await repo.commonDir(project.path);
    if (!repoRoot) {
      throw badRequest("The project folder is no longer a Git repository");
    }
    const base = {
      createdAt: this.#now().toISOString(),
      id: randomUUID(),
      missionId,
      projectId: project.id,
      repoRoot,
    };
    if (request.mode === "new_worktree") {
      return await this.#createWorktree(
        base,
        project,
        request,
        operationId,
        title
      );
    }
    const target =
      request.mode === "current_checkout"
        ? project.path
        : await repo.canonical(path.resolve(request.path));
    if (!target) {
      throw badRequest("That worktree folder does not exist");
    }
    if (request.mode === "existing_worktree") {
      const listed = await repo.worktrees(project.path);
      const known = await Promise.all(
        listed.map((w) => repo.canonical(w.path))
      );
      if (!known.includes(target)) {
        throw badRequest("That folder is not a worktree of this repository");
      }
    }
    const entries = await repo.status(target);
    if (entries === null) {
      throw conflict("Could not read the checkout status");
    }
    if (entries.length > 0 && !request.acknowledgeDirty) {
      throw new AppError(
        "conflict",
        "This checkout has uncommitted changes. Confirm to work alongside them."
      );
    }
    const [branch, startRevision] = await Promise.all([
      repo.currentBranch(target),
      repo.head(target),
    ]);
    return {
      ...base,
      // Pull requests target the repository's default branch, not the branch
      // the user happens to have checked out.
      baseRef: project.defaultBranch ?? branch,
      baselineDirtyFiles: [
        ...new Set(
          entries.flatMap((entry) =>
            entry.oldPath ? [entry.path, entry.oldPath] : [entry.path]
          )
        ),
      ],
      branch,
      mode: request.mode,
      owned: false,
      path: target,
      startRevision,
    };
  }

  async #createWorktree(
    base: Pick<
      WorkspaceBinding,
      "createdAt" | "id" | "missionId" | "projectId" | "repoRoot"
    >,
    project: Project,
    request: Extract<WorkspaceRequest, { mode: "new_worktree" }>,
    operationId: string,
    title: string
  ): Promise<WorkspaceBinding> {
    const suffix = missionSuffix(base.missionId);
    const branch =
      request.branchName?.trim() || `missions/${slugify(title)}-${suffix}`;
    if (!VALID_BRANCH.test(branch)) {
      throw badRequest("That branch name is not valid");
    }
    if (await repo.branchExists(project.path, branch)) {
      throw conflict(`Branch ${branch} already exists`);
    }
    const root = this.#settings().worktreeRoot;
    const target = path.join(
      root,
      `${slugify(project.name)}-${slugify(title)}-${suffix}`
    );
    if (existsSync(target)) {
      throw conflict(`${target} already exists`);
    }
    await mkdir(root, { recursive: true });
    await this.#journal.run(
      {
        detail: { baseBranch: request.baseBranch, branch, path: target },
        id: `${operationId}:worktree`,
        kind: "workspace.create_worktree",
        missionId: base.missionId,
      },
      async () => {
        const result = await git(project.path, [
          "worktree",
          "add",
          "-b",
          branch,
          "--",
          target,
          request.baseBranch,
        ]);
        if (!result.ok) {
          throw new AppError(
            "bad_request",
            result.stderr.split("\n").at(-1) || "Could not create the worktree"
          );
        }
        return { branch, path: target };
      }
    );
    const canonicalPath = (await repo.canonical(target)) ?? target;
    return {
      ...base,
      baseRef: request.baseBranch,
      baselineDirtyFiles: [],
      branch,
      mode: "new_worktree",
      owned: true,
      path: canonicalPath,
      startRevision: await repo.head(canonicalPath),
    };
  }
}

/** Resume checks the stored binding instead of recreating or switching it. */
export const verifyBinding = async (
  binding: WorkspaceBinding
): Promise<string[]> => {
  const problems: string[] = [];
  const actual = await repo.canonical(binding.path);
  if (actual !== binding.path) {
    return [`The mission folder ${binding.path} is missing or moved`];
  }
  const [common, branch] = await Promise.all([
    repo.commonDir(binding.path),
    repo.currentBranch(binding.path),
  ]);
  if (common !== binding.repoRoot) {
    problems.push("The mission folder now belongs to a different repository");
  }
  if (branch !== binding.branch) {
    problems.push(
      `Expected branch ${binding.branch ?? "a detached HEAD"}, found ${branch ?? "a detached HEAD"}`
    );
  }
  return problems;
};

const cleanupInspection = async (
  binding: WorkspaceBinding,
  expectedHead?: string | null
): Promise<{ main: string; head: string } | string> => {
  if (!binding.owned) {
    return "Missions did not create this folder, so it is kept";
  }
  const problems = await verifyBinding(binding);
  if (problems.length > 0) {
    return problems.join("; ");
  }
  const entries = await repo.status(binding.path);
  if (entries === null) {
    return "Could not read the worktree status";
  }
  if (entries.length > 0) {
    return "The worktree has uncommitted changes, so it is kept";
  }
  const localHead = await repo.head(binding.path);
  if (
    !localHead ||
    (expectedHead !== undefined && localHead !== expectedHead)
  ) {
    return "The worktree HEAD moved or could not be verified";
  }
  if (binding.branch) {
    const branchHead = await git(binding.path, [
      "rev-parse",
      "--verify",
      `refs/heads/${binding.branch}`,
    ]);
    if (!branchHead.ok || branchHead.stdout !== localHead) {
      return "The stored branch no longer points at the worktree HEAD";
    }
  }
  const trees = await repo.worktrees(binding.path);
  const main = trees.find((tree) => tree.isMain)?.path;
  if (!main || (await repo.canonical(main)) === binding.path) {
    return "Refusing to remove the main checkout";
  }
  const latestProblems = await verifyBinding(binding);
  if (
    (await repo.commonDir(main)) !== binding.repoRoot ||
    latestProblems.length > 0 ||
    (await repo.head(binding.path)) !== localHead
  ) {
    return "The worktree identity changed during cleanup";
  }
  return { head: localHead, main };
};

/** Immutable deletion decision, recorded before removing either folder or ref. */
export const planCleanup = async (
  binding: WorkspaceBinding,
  mergedHead: string | null
) => {
  const inspected = await cleanupInspection(binding);
  if (typeof inspected === "string") {
    return {
      branchDeletionExpected: false,
      branchOid: null,
      cleanupBlockedReason: inspected,
      expectedHead: null,
    };
  }
  const merged = await git(inspected.main, [
    "merge-base",
    "--is-ancestor",
    inspected.head,
    "HEAD",
  ]);
  if (merged.code !== 0 && merged.code !== 1) {
    throw conflict("Could not verify whether the cleanup branch is merged");
  }
  const trees = await repo.worktrees(inspected.main);
  const otherCheckout = trees.some(
    (tree) => tree.path !== binding.path && tree.branch === binding.branch
  );
  return {
    branchDeletionExpected:
      Boolean(binding.branch) &&
      !otherCheckout &&
      (merged.ok || mergedHead === inspected.head),
    branchOid: binding.branch ? inspected.head : null,
    cleanupBlockedReason: null,
    expectedHead: inspected.head,
  };
};

const deleteReviewedBranch = async (
  binding: WorkspaceBinding,
  main: string,
  localHead: string,
  mergedHead?: string | null
): Promise<CleanupResult> => {
  const merged = await git(main, [
    "merge-base",
    "--is-ancestor",
    localHead,
    "HEAD",
  ]);
  const trees = await repo.worktrees(main);
  const checkedOut = trees.some((tree) => tree.branch === binding.branch);
  if (!checkedOut && (merged.ok || mergedHead === localHead)) {
    // The expected OID makes deletion atomic even if an external Git client
    // advances the ref after the worktree inspection.
    const deleted = await git(main, [
      "update-ref",
      "-d",
      `refs/heads/${binding.branch}`,
      localHead,
    ]);
    if (deleted.code === null && !deleted.missing) {
      throw new Error("Branch deletion did not finish; its outcome is unknown");
    }
    return {
      branchDeleted: deleted.ok,
      reason: deleted.ok ? null : deleted.stderr,
      removed: true,
    };
  }
  return {
    branchDeleted: false,
    reason: "The branch has commits that are not merged, so it is kept",
    removed: true,
  };
};

/** Caller holds the stopped-runtime workspace mutation interval. */
export const cleanupBinding = async (
  binding: WorkspaceBinding,
  options: CleanupOptions
): Promise<CleanupResult> => {
  const inspected = await cleanupInspection(binding, options.expectedHead);
  if (typeof inspected === "string") {
    return { branchDeleted: false, reason: inspected, removed: false };
  }
  const removed = await git(inspected.main, [
    "worktree",
    "remove",
    "--",
    binding.path,
  ]);
  if (removed.code === null && !removed.missing) {
    throw new Error("Worktree removal did not finish; its outcome is unknown");
  }
  if (!removed.ok) {
    return {
      branchDeleted: false,
      reason: removed.stderr || "git worktree remove failed",
      removed: false,
    };
  }
  if (!(options.deleteBranch && binding.branch)) {
    return { branchDeleted: false, reason: null, removed: true };
  }
  if (options.allowBranchDeletion === false) {
    return {
      branchDeleted: false,
      reason: "The branch has commits that are not merged, so it is kept",
      removed: true,
    };
  }
  return await deleteReviewedBranch(
    binding,
    inspected.main,
    inspected.head,
    options.mergedHead
  );
};
