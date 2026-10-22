import { realpath } from "node:fs/promises";
import path from "node:path";

import type { Branch } from "@missions/protocol/projects";
import type { WorktreeInfo } from "@missions/protocol/workspaces";

import { git, redactUrl } from "../lib/exec";

export interface StatusEntry {
  /** Two-character porcelain code, e.g. " M", "??", "R ". */
  code: string;
  path: string;
  oldPath: string | null;
}

const out = async (cwd: string, args: string[]) => {
  const result = await git(cwd, args);
  return result.ok ? result.stdout.trim() : null;
};

export const canonical = async (target: string) => {
  try {
    return await realpath(target);
  } catch {
    return null;
  }
};

export const topLevel = async (dir: string) => {
  const top = await out(dir, ["rev-parse", "--show-toplevel"]);
  return top ? await canonical(top) : null;
};

/** Repository identity shared by every worktree of one repository. */
export const commonDir = async (dir: string) => {
  const common = await out(dir, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  return common ? await canonical(common) : null;
};

export const currentBranch = (dir: string) =>
  out(dir, ["symbolic-ref", "--quiet", "--short", "HEAD"]);

export const head = (dir: string) =>
  out(dir, ["rev-parse", "--verify", "--quiet", "HEAD"]);

export const remoteUrl = async (dir: string) => {
  const url = await out(dir, ["remote", "get-url", "origin"]);
  return url ? redactUrl(url) : null;
};

export const defaultBranch = async (dir: string) => {
  const remoteHead = await out(dir, [
    "symbolic-ref",
    "--quiet",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  if (remoteHead) {
    return remoteHead.replace(/^origin\//u, "");
  }
  return await currentBranch(dir);
};

/** Parses `git status --porcelain=v1 -z`, including rename source paths. */
export const parseStatus = (raw: string): StatusEntry[] => {
  const parts = raw.split("\0");
  const entries: StatusEntry[] = [];
  let index = 0;
  while (index < parts.length) {
    const part = parts[index] ?? "";
    index += 1;
    if (part.length < 4) {
      continue;
    }
    const code = part.slice(0, 2);
    const entry: StatusEntry = { code, oldPath: null, path: part.slice(3) };
    if (code.includes("R") || code.includes("C")) {
      entry.oldPath = parts[index] ?? null;
      index += 1;
    }
    entries.push(entry);
  }
  return entries;
};

export const status = async (dir: string): Promise<StatusEntry[] | null> => {
  const result = await git(dir, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  return result.ok ? parseStatus(result.stdout) : null;
};

export const branches = async (dir: string): Promise<Branch[]> => {
  const raw = await out(dir, [
    "for-each-ref",
    "--format=%(refname)%09%(HEAD)",
    "refs/heads",
    "refs/remotes",
  ]);
  if (!raw) {
    return [];
  }
  return raw
    .split("\n")
    .map((line) => {
      const [ref = "", mark = ""] = line.split("\t");
      const remote = ref.startsWith("refs/remotes/");
      const name = ref.replace(/^refs\/(?:heads|remotes)\//u, "");
      return { current: mark === "*", name, remote };
    })
    .filter((branch) => branch.name !== "" && !branch.name.endsWith("/HEAD"));
};

export const branchExists = async (dir: string, name: string) => {
  const result = await git(dir, [
    "show-ref",
    "--verify",
    "--quiet",
    `refs/heads/${name}`,
  ]);
  return result.ok;
};

export const worktrees = async (dir: string): Promise<WorktreeInfo[]> => {
  const raw = await out(dir, ["worktree", "list", "--porcelain"]);
  if (!raw) {
    return [];
  }
  const blocks = raw.split(/\n\n+/u).filter(Boolean);
  const parsed = blocks.map((block, position) => {
    const info: WorktreeInfo = {
      branch: null,
      dirty: false,
      head: null,
      isMain: position === 0,
      path: "",
    };
    for (const line of block.split("\n")) {
      if (line.startsWith("worktree ")) {
        info.path = line.slice("worktree ".length);
      } else if (line.startsWith("HEAD ")) {
        info.head = line.slice("HEAD ".length);
      } else if (line.startsWith("branch ")) {
        info.branch = line
          .slice("branch ".length)
          .replace(/^refs\/heads\//u, "");
      }
    }
    return info;
  });
  return await Promise.all(
    parsed.map(async (info) => {
      const entries = await status(info.path);
      return { ...info, dirty: entries === null ? false : entries.length > 0 };
    })
  );
};

export const isInside = (root: string, target: string) => {
  const rel = path.relative(root, target);
  return rel === "" || !(rel.startsWith("..") || path.isAbsolute(rel));
};
