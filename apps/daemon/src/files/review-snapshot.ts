import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, lstat, mkdtemp, readlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import type { WorkspaceBinding } from "@missions/protocol/workspaces";

import { currentBranch, head, status } from "../git/repo";
import { conflict } from "../lib/app-error";
import { git } from "../lib/exec";
import type { RunOptions } from "../lib/exec";

export interface ReviewedEntry {
  path: string;
  mode: string;
  oid: string;
  rawHash?: string;
}

export interface ReviewSnapshot {
  branch: string | null;
  head: string | null;
  tree: string;
  index: string;
  hash: string;
  entries: ReviewedEntry[];
  status: NonNullable<Awaited<ReturnType<typeof status>>>;
}

export const checkedGit = async (
  root: string,
  args: string[],
  options: RunOptions = {}
) => {
  const result = await git(root, args, options);
  if (result.code === null && !result.missing) {
    throw new Error(
      `Git ${args[0] ?? ""} did not finish; its outcome is unknown`
    );
  }
  if (!result.ok) {
    throw conflict(result.stderr || `Could not read Git ${args[0] ?? ""}`);
  }
  return result.stdout;
};

/** Index-info uses NUL-delimited literal names, never filename pathspecs. */
export const updateIndex = async (
  root: string,
  index: string,
  entries: ReviewedEntry[]
) => {
  if (entries.length === 0) {
    return;
  }
  await checkedGit(root, ["update-index", "-z", "--index-info"], {
    env: { GIT_INDEX_FILE: index },
    input: entries
      .map((entry) => `${entry.mode} ${entry.oid}\t${entry.path}\0`)
      .join(""),
  });
};

export const withPrivateIndex = async <T>(
  effect: (index: string) => Promise<T>,
  source?: string
) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "missions-review-"));
  const index = path.join(dir, "index");
  try {
    if (source) {
      await copyFile(source, index);
    }
    return await effect(index);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
};

export const reviewedTree = (
  root: string,
  parent: string | null,
  entries: ReviewedEntry[]
) =>
  withPrivateIndex(async (index) => {
    const env = { GIT_INDEX_FILE: index };
    await checkedGit(root, ["read-tree", parent ?? "--empty"], { env });
    await updateIndex(root, index, entries);
    return await checkedGit(root, ["write-tree"], { env });
  });

const captureBlob = (root: string, rel: string, file: string) =>
  withPrivateIndex(async (index) => {
    const captured = path.join(path.dirname(index), "bytes");
    await copyFile(file, captured);
    const digest = createHash("sha256");
    await pipeline(createReadStream(captured), digest);
    const oid = await checkedGit(
      root,
      ["hash-object", "-w", `--path=${rel}`, "--stdin"],
      { inputFile: captured }
    );
    return { oid, rawHash: digest.digest("hex") };
  });

/** Bound filesystem and Git subprocess fanout even for large inventories. */
export const mapReviewItems = async <T, R>(
  items: T[],
  effect: (item: T) => Promise<R>
): Promise<R[]> => {
  const results: R[] = [];
  const iterator = items.entries();
  const visit = async (): Promise<void> => {
    const next = iterator.next();
    if (next.done) {
      return;
    }
    const [position, item] = next.value;
    results[position] = await effect(item);
    await visit();
  };
  await Promise.all(Array.from({ length: Math.min(8, items.length) }, visit));
  return results;
};

/**
 * Capture bytes once into immutable Git objects. Review previews and publishing
 * share these objects; neither the preview budget nor later worktree edits can
 * change the approved snapshot.
 */
export const captureReview = async (
  binding: WorkspaceBinding
): Promise<ReviewSnapshot> => {
  const root = binding.path;
  const [currentHead, dirty, index, branch, objectFormat] = await Promise.all([
    head(root),
    status(root),
    checkedGit(root, ["ls-files", "--stage", "-z"]),
    currentBranch(root),
    checkedGit(root, ["rev-parse", "--show-object-format"]),
  ]);
  if (dirty === null) {
    throw conflict("Could not read the workspace status");
  }
  const staged = new Map<string, string>();
  for (const record of index.split("\0").filter(Boolean)) {
    const tab = record.indexOf("\t");
    const [mode, , stage] = record.slice(0, tab).split(" ");
    if (stage !== "0") {
      throw conflict("Resolve the index conflicts before reviewing");
    }
    staged.set(record.slice(tab + 1), mode ?? "");
  }
  const paths = new Set(
    dirty.flatMap((entry) =>
      entry.oldPath ? [entry.path, entry.oldPath] : [entry.path]
    )
  );
  const entries = await mapReviewItems(
    [...paths].toSorted(),
    async (rel): Promise<ReviewedEntry> => {
      const file = path.join(root, rel);
      const info = await lstat(file).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT" || error.code === "ENOTDIR") {
          return null;
        }
        throw error;
      });
      let source: RunOptions | null = null;
      let mode = "0";
      let oid = "0".repeat(objectFormat === "sha256" ? 64 : 40);
      let rawHash: string | undefined;
      if (info?.isSymbolicLink()) {
        source = { input: Buffer.from(await readlink(file)) };
        mode = "120000";
      } else if (info?.isFile()) {
        ({ oid, rawHash } = await captureBlob(root, rel, file));
        mode = info.mode
          .toString(8)
          .slice(-3)
          .split("")
          .some((digit) => Number(digit) % 2 === 1)
          ? "100755"
          : "100644";
      } else if (info?.isDirectory() && staged.get(rel) === "160000") {
        const nestedChanges = await status(file);
        if (!nestedChanges || nestedChanges.length > 0) {
          throw conflict(
            `Commit the changes inside submodule ${rel} before reviewing its revision`
          );
        }
        mode = "160000";
        oid = (await head(file)) ?? "";
        if (!oid) {
          throw conflict(`Could not read submodule ${rel}`);
        }
      } else if (info) {
        throw conflict(`Cannot review ${rel}: not a regular file`);
      }
      if (source) {
        oid = await checkedGit(root, ["hash-object", "-w", "--stdin"], source);
        rawHash = createHash("sha256")
          .update(source.input ?? "")
          .digest("hex");
      }
      return { mode, oid, path: rel, rawHash };
    }
  );
  const tree = await reviewedTree(root, currentHead, entries);
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        base: binding.startRevision,
        baseline: binding.baselineDirtyFiles.toSorted(),
        branch,
        entries,
        head: currentHead,
        index,
        status: dirty,
        tree,
      })
    )
    .digest("hex");
  return {
    branch,
    entries,
    hash,
    head: currentHead,
    index,
    status: dirty,
    tree,
  };
};
