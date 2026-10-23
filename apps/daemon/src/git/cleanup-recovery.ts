import { lstat } from "node:fs/promises";
import path from "node:path";

import { WorkspaceBindingSchema } from "@missions/protocol/workspaces";
import { z } from "zod";

import { checkedGit } from "../files/review-snapshot";
import { conflict } from "../lib/app-error";
import { git } from "../lib/exec";
import { canonical, commonDir } from "./repo";

export const CleanupIntentSchema = z.object({
  action: z.literal("remove"),
  binding: WorkspaceBindingSchema,
  branchDeletionExpected: z.boolean(),
  branchOid: z.string().nullable(),
  cleanupBlockedReason: z.string().nullable(),
  expectedHead: z.string().nullable(),
  mergedHead: z.string().nullable(),
});

/** Observation only: never remove a remaining folder, registration or branch. */
export const observeCleanup = async (detail: Record<string, unknown>) => {
  const intent = CleanupIntentSchema.parse(detail);
  const { binding } = intent;
  if (!binding.owned || intent.cleanupBlockedReason || !intent.expectedHead) {
    throw conflict(
      "The original cleanup intent did not authorize removing this workspace"
    );
  }
  const exists = await lstat(binding.path).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  );
  if (
    exists ||
    (await canonical(binding.repoRoot)) !== binding.repoRoot ||
    (await commonDir(binding.repoRoot)) !== binding.repoRoot
  ) {
    throw conflict("The original workspace removal cannot be verified");
  }
  const registrations = await checkedGit(binding.repoRoot, [
    "worktree",
    "list",
    "--porcelain",
    "-z",
  ]);
  const stillRegistered = registrations
    .split("\0")
    .some(
      (record) =>
        record.startsWith("worktree ") &&
        path.resolve(record.slice("worktree ".length)) === binding.path
    );
  if (stillRegistered) {
    throw conflict(
      "The original worktree is still registered; cleanup remains unconfirmed"
    );
  }
  if (binding.branch) {
    const ref = `refs/heads/${binding.branch}`;
    const found = await git(binding.repoRoot, [
      "show-ref",
      "--verify",
      "--quiet",
      ref,
    ]);
    if (found.code !== 0 && found.code !== 1) {
      throw new Error("Could not verify the original cleanup branch");
    }
    if (intent.branchDeletionExpected) {
      if (found.ok) {
        throw conflict(
          "The original cleanup branch still exists; no deletion is retried"
        );
      }
    } else {
      const oid = found.ok
        ? await checkedGit(binding.repoRoot, ["rev-parse", "--verify", ref])
        : null;
      if (oid !== intent.branchOid) {
        throw conflict(
          "The retained cleanup branch no longer has its original exact OID"
        );
      }
    }
  }
  return {
    binding,
    reason:
      !binding.branch || intent.branchDeletionExpected
        ? null
        : "The branch has commits that are not merged, so it is kept",
  };
};
