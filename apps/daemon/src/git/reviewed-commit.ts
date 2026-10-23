import { copyFile, open, rename, rm } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  checkedGit,
  updateIndex,
  withPrivateIndex,
} from "../files/review-snapshot";
import type { ReviewedEntry, ReviewSnapshot } from "../files/review-snapshot";
import { stale } from "../lib/app-error";
import { currentBranch, head } from "./repo";

export const ReviewedCommitIntentSchema = z.object({
  branch: z.string().nullable(),
  candidateId: z.string(),
  entries: z.array(
    z.object({
      mode: z.enum(["0", "100644", "100755", "120000", "160000"]),
      oid: z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u),
      path: z.string().min(1),
      rawHash: z.string().optional(),
    })
  ),
  expectedHead: z.string().nullable(),
  message: z.string(),
  originalIndex: z.string(),
  /** Absent on legacy candidates whose native post-commit already ran. */
  postCommitId: z.string().optional(),
  tree: z.string(),
});
export type ReviewedCommitIntent = z.infer<typeof ReviewedCommitIntentSchema>;
export const ReviewedCommitResultSchema = z.object({
  message: z.string(),
  sha: z.string(),
});

const expectedIndex = (root: string, intent: ReviewedCommitIntent) =>
  withPrivateIndex(async (index) => {
    const env = { GIT_INDEX_FILE: index };
    await checkedGit(root, ["read-tree", "--empty"], { env });
    if (intent.originalIndex) {
      await checkedGit(root, ["update-index", "-z", "--index-info"], {
        env,
        input: intent.originalIndex,
      });
    }
    await updateIndex(root, index, intent.entries);
    return await checkedGit(root, ["ls-files", "--stage", "-z"], { env });
  });

/** Repair only the recorded selected entries; divergent user staging is never overwritten. */
export const repairReviewedIndex = async (
  root: string,
  intent: ReviewedCommitIntent,
  sha: string
) => {
  const nextManifest = await expectedIndex(root, intent);
  const indexPath = path.resolve(
    root,
    await checkedGit(root, ["rev-parse", "--git-path", "index"])
  );
  const lockPath = `${indexPath}.lock`;
  const lock = await open(lockPath, "wx");
  try {
    const current = await checkedGit(root, ["ls-files", "--stage", "-z"]);
    if (current === nextManifest) {
      return;
    }
    if (
      current !== intent.originalIndex ||
      (await currentBranch(root)) !== intent.branch ||
      (await head(root)) !== sha
    ) {
      throw stale(
        "The index or checkout diverged after the interrupted commit; it was kept unchanged"
      );
    }
    await withPrivateIndex(async (nextIndex) => {
      await copyFile(indexPath, nextIndex).catch(
        async (error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") {
            throw error;
          }
          await checkedGit(root, ["read-tree", "--empty"], {
            env: { GIT_INDEX_FILE: nextIndex },
          });
        }
      );
      await updateIndex(root, nextIndex, intent.entries);
      await copyFile(nextIndex, lockPath);
      await rename(lockPath, indexPath);
    });
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
};

/** Compare-and-swap HEAD and replace only approved index entries under its lock. */
export const installReviewedCommit = async (
  root: string,
  snapshot: Pick<ReviewSnapshot, "branch" | "head" | "index">,
  entries: ReviewedEntry[],
  sha: string
) => {
  const indexPath = path.resolve(
    root,
    await checkedGit(root, ["rev-parse", "--git-path", "index"])
  );
  const lockPath = `${indexPath}.lock`;
  const lock = await open(lockPath, "wx");
  try {
    const currentIndex = await checkedGit(root, ["ls-files", "--stage", "-z"]);
    if (currentIndex !== snapshot.index) {
      throw stale("The index moved since review; review again");
    }
    if ((await currentBranch(root)) !== snapshot.branch) {
      throw stale("The checked-out branch moved since review; review again");
    }
    await withPrivateIndex(async (nextIndex) => {
      await copyFile(indexPath, nextIndex).catch(
        async (error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") {
            throw error;
          }
          await checkedGit(root, ["read-tree", "--empty"], {
            env: { GIT_INDEX_FILE: nextIndex },
          });
        }
      );
      await updateIndex(root, nextIndex, entries);
      await copyFile(nextIndex, lockPath);
      // update-ref's old OID guards external Git clients as well as missions.
      await checkedGit(root, [
        "update-ref",
        "-m",
        "missions: reviewed commit",
        snapshot.branch ? `refs/heads/${snapshot.branch}` : "HEAD",
        sha,
        snapshot.head ?? "0".repeat(sha.length),
      ]);
      await rename(lockPath, indexPath);
    });
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
};
