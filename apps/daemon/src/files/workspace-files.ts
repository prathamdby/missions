import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";

import type {
  Changes,
  ComparisonMode,
  DiffHunk,
  DiffLine,
  FileContent,
  FileDiff,
  FileNode,
  FileTree,
} from "@missions/protocol/files";
import type { WorkspaceBinding } from "@missions/protocol/workspaces";

import {
  canonical,
  currentBranch,
  head as headRevision,
  isInside,
  status,
} from "../git/repo";
import { badRequest, conflict, forbidden } from "../lib/app-error";
import { git } from "../lib/exec";
import { captureReview, checkedGit, mapReviewItems } from "./review-snapshot";
import type { ReviewSnapshot } from "./review-snapshot";

export const TEXT_LIMIT = 512 * 1024;
const SNIFF_BYTES = 8192;
const FILE_LINE_BUDGET = 1500;
const TOTAL_LINE_BUDGET = 15_000;
const TOTAL_BYTE_BUDGET = 2 * 1024 * 1024;
const DIR_LIMIT = 2000;

const MEDIA_TYPES: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webm": "video/webm",
  ".webp": "image/webp",
};

export const mediaTypeOf = (file: string) =>
  MEDIA_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";

type ChangeKind = NonNullable<FileNode["change"]>;

export interface ResolvedPath {
  rel: string;
  abs: string;
  /** Canonical target, or null when it does not exist. */
  real: string | null;
}

/**
 * Maps a client-supplied relative path into the workspace. Absolute paths,
 * `..` segments, `.git` internals and symlinks that leave the workspace are
 * all rejected.
 */
export const resolveWorkspacePath = async (
  root: string,
  raw: string
): Promise<ResolvedPath> => {
  if (raw.includes("\0")) {
    throw badRequest("Invalid path");
  }
  const posix = raw.replaceAll("\\", "/");
  if (path.isAbsolute(posix) || /^[a-z]:/iu.test(posix)) {
    throw forbidden("Paths must be relative to the mission folder");
  }
  const segments = posix
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".");
  if (segments.includes("..")) {
    throw forbidden("Path escapes the mission folder");
  }
  if (segments.includes(".git")) {
    throw forbidden("Git internals are not browsable");
  }
  const rel = segments.join("/");
  const abs = path.resolve(root, rel);
  const realRoot = (await canonical(root)) ?? root;
  if (!isInside(root, abs)) {
    throw forbidden("Path escapes the mission folder");
  }
  const real = await canonical(abs);
  if (real && !isInside(realRoot, real)) {
    throw forbidden("Path resolves outside the mission folder");
  }
  if (real && path.relative(realRoot, real).split(path.sep).includes(".git")) {
    throw forbidden("Git internals are not browsable");
  }
  return { abs, real, rel };
};

const isBinary = (buffer: Buffer) =>
  buffer.subarray(0, SNIFF_BYTES).includes(0);

const readHead = async (file: string, limit: number) => {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(limit);
    const { bytesRead } = await handle.read(buffer, 0, limit, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
};

export const readWorkspaceFile = async (
  binding: Pick<WorkspaceBinding, "path">,
  raw: string
): Promise<FileContent> => {
  const target = await resolveWorkspacePath(binding.path, raw);
  if (!target.real) {
    return { kind: "missing", path: target.rel };
  }
  const info = await stat(target.real);
  if (!info.isFile()) {
    throw badRequest("Not a file");
  }
  const buffer = await readHead(target.real, Math.min(info.size, TEXT_LIMIT));
  if (isBinary(buffer)) {
    return {
      kind: "binary",
      mediaType: mediaTypeOf(target.rel),
      path: target.rel,
      size: info.size,
    };
  }
  return {
    content: buffer.toString("utf-8"),
    kind: "text",
    path: target.rel,
    size: info.size,
    truncated: info.size > TEXT_LIMIT,
  };
};

// ----------------------------------------------------------------- changes

interface NameStatus {
  status: FileDiff["status"];
  path: string;
  oldPath: string | null;
}

const STATUS_CODES: Record<string, FileDiff["status"]> = {
  A: "added",
  C: "added",
  D: "deleted",
  M: "modified",
  R: "renamed",
  T: "modified",
};

/** Parses `git diff --name-status -z`. */
export const parseNameStatus = (raw: string): NameStatus[] => {
  const parts = raw.split("\0").filter((part) => part !== "");
  const entries: NameStatus[] = [];
  let index = 0;
  while (index < parts.length) {
    const code = parts[index] ?? "";
    const letter = code.charAt(0);
    if (letter === "R" || letter === "C") {
      entries.push({
        oldPath: parts[index + 1] ?? null,
        path: parts[index + 2] ?? "",
        status: STATUS_CODES[letter] ?? "modified",
      });
      index += 3;
    } else {
      entries.push({
        oldPath: null,
        path: parts[index + 1] ?? "",
        status: STATUS_CODES[letter] ?? "modified",
      });
      index += 2;
    }
  }
  return entries;
};

interface ParsedPatch {
  binary: boolean;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

const HUNK_HEADER =
  /^@@ -(?<oldStart>\d+)(?:,\d+)? \+(?<newStart>\d+)(?:,\d+)? @@/u;

const parseHunkLines = (lines: readonly string[]): ParsedPatch => {
  const parsed: ParsedPatch = {
    additions: 0,
    binary: false,
    deletions: 0,
    hunks: [],
  };
  let current: DiffHunk | null = null;
  let oldNumber = 0;
  let newNumber = 0;
  for (const line of lines) {
    const header = HUNK_HEADER.exec(line);
    if (header?.groups) {
      current = { header: line, lines: [] };
      parsed.hunks.push(current);
      oldNumber = Number(header.groups.oldStart);
      newNumber = Number(header.groups.newStart);
    } else if (
      line.startsWith("Binary files ") ||
      line.startsWith("GIT binary patch")
    ) {
      parsed.binary = true;
    } else if (current && !line.startsWith("\\")) {
      const marker = line.charAt(0);
      let entry: DiffLine;
      if (marker === "+") {
        entry = {
          kind: "add",
          newNumber,
          oldNumber: null,
          text: line.slice(1),
        };
        newNumber += 1;
        parsed.additions += 1;
      } else if (marker === "-") {
        entry = {
          kind: "del",
          newNumber: null,
          oldNumber,
          text: line.slice(1),
        };
        oldNumber += 1;
        parsed.deletions += 1;
      } else if (marker === " ") {
        entry = { kind: "context", newNumber, oldNumber, text: line.slice(1) };
        oldNumber += 1;
        newNumber += 1;
      } else {
        continue;
      }
      current.lines.push(entry);
    }
  }
  return parsed;
};

/** Splits a multi-file unified diff into per-file line lists, in order. */
export const splitPatch = (patch: string): string[][] => {
  const files: string[][] = [];
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      files.push([]);
    } else {
      files.at(-1)?.push(line);
    }
  }
  return files;
};

export const parsePatch = (lines: readonly string[]) => parseHunkLines(lines);

const budget = (
  parsed: ParsedPatch,
  remaining: number,
  remainingBytes: number
) => {
  const limit = Math.min(FILE_LINE_BUDGET, remaining);
  const byteLimit = Math.min(TEXT_LIMIT, remainingBytes);
  let used = 0;
  let bytes = 0;
  let byteCut = false;
  const hunks: DiffHunk[] = [];
  for (const hunk of parsed.hunks) {
    const lines: DiffLine[] = [];
    for (const line of hunk.lines) {
      if (used >= limit || bytes >= byteLimit) {
        break;
      }
      const buffer = Buffer.from(line.text);
      const available = byteLimit - bytes;
      const text = buffer.subarray(0, available).toString("utf-8");
      byteCut ||= buffer.length > available;
      lines.push({ ...line, text });
      bytes += Math.min(buffer.length, available);
      used += 1;
    }
    if (lines.length > 0) {
      hunks.push({ header: hunk.header, lines });
    }
  }
  const total = parsed.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0);
  return { bytes, hunks, truncated: byteCut || used < total, used };
};

const patchCounts = (raw: string): ParsedPatch => {
  const parsed: ParsedPatch = {
    additions: 0,
    binary: false,
    deletions: 0,
    hunks: [],
  };
  const records = raw.split("\0");
  let position = 0;
  while (position < records.length) {
    const record = records[position] ?? "";
    if (!record) {
      break;
    }
    const [additions, deletions, ...name] = record.split("\t");
    parsed.binary ||= additions === "-" || deletions === "-";
    parsed.additions += Number(additions === "-" ? 0 : additions);
    parsed.deletions += Number(deletions === "-" ? 0 : deletions);
    // A rename's empty pathname is followed by two NUL-delimited names.
    position += name.join("\t") === "" ? 3 : 1;
  }
  return parsed;
};

/** Never collect an unbounded patch merely to cut it down for the browser. */
const previewDiff = async (
  root: string,
  from: string,
  to: string,
  paths: string[]
) => {
  const options = [
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "-M",
  ];
  const counts = await checkedGit(root, [
    ...options,
    "--numstat",
    "-z",
    from,
    to,
    "--",
    ...paths,
  ]);
  if (!counts) {
    return { empty: true, parsed: patchCounts(""), truncated: false };
  }
  const sizes = await Promise.all(
    [from, to].map((tree) =>
      checkedGit(root, [
        "ls-tree",
        "-r",
        "-z",
        "--format=%(objectsize)",
        tree,
        "--",
        ...paths,
      ])
    )
  );
  const oversized = sizes.some((raw) =>
    raw.split("\0").some((size) => Number(size) > TEXT_LIMIT)
  );
  if (oversized) {
    const parsed = patchCounts(counts);
    return { empty: false, parsed, truncated: !parsed.binary };
  }
  const patch = await checkedGit(root, [
    ...options,
    "--unified=3",
    from,
    to,
    "--",
    ...paths,
  ]);
  return {
    empty: false,
    parsed: parseHunkLines(splitPatch(patch).flat()),
    truncated: false,
  };
};

/**
 * Everything that differs from the mission's start revision, including
 * untracked files. The hash binds a commit approval to exactly this review.
 */
export const workspaceChanges = async (
  binding: WorkspaceBinding,
  captured?: ReviewSnapshot
): Promise<Changes> => {
  const snapshot = captured ?? (await captureReview(binding));
  const root = binding.path;
  const empty = await checkedGit(
    root,
    ["hash-object", "-w", "-t", "tree", "--stdin"],
    { input: "" }
  );
  const base = binding.startRevision ?? empty;
  const current = snapshot.head ?? empty;
  const names = async (from: string, to: string) =>
    parseNameStatus(
      await checkedGit(root, [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "-M",
        "--name-status",
        "-z",
        from,
        to,
        "--",
      ])
    );
  const [net, history, pending] = await Promise.all([
    names(base, snapshot.tree),
    names(base, current),
    names(current, snapshot.tree),
  ]);
  const inventory = new Map<string, NameStatus>();
  for (const entry of [...net, ...pending, ...history]) {
    if (!inventory.has(entry.path)) {
      inventory.set(entry.path, entry);
    }
  }
  for (const entry of snapshot.status) {
    const previous = inventory.get(entry.path);
    let entryStatus = previous?.status ?? "modified";
    if (entry.code === "??") {
      entryStatus = "untracked";
    } else if (entry.oldPath) {
      entryStatus = "renamed";
    }
    inventory.set(entry.path, {
      oldPath: entry.oldPath ?? previous?.oldPath ?? null,
      path: entry.path,
      status: entryStatus,
    });
  }
  const dirty = new Set(
    snapshot.status.flatMap((entry) =>
      entry.oldPath ? [entry.path, entry.oldPath] : [entry.path]
    )
  );
  const baseline = new Set(binding.baselineDirtyFiles);
  let remaining = TOTAL_LINE_BUDGET;
  let remainingBytes = TOTAL_BYTE_BUDGET;
  const files: FileDiff[] = [];
  const previews = await mapReviewItems(
    [...inventory.values()].toSorted((a, b) => a.path.localeCompare(b.path)),
    async (entry) => {
      const paths = entry.oldPath ? [entry.oldPath, entry.path] : [entry.path];
      let preview = await previewDiff(root, base, snapshot.tree, paths);
      if (preview.empty && dirty.has(entry.path)) {
        preview = await previewDiff(root, current, snapshot.tree, paths);
      }
      return { entry, paths, preview };
    }
  );
  for (const { entry, preview, paths } of previews) {
    const { parsed } = preview;
    const cut = budget(parsed, remaining, remainingBytes);
    remaining -= cut.used;
    remainingBytes -= cut.bytes;
    files.push({
      additions: parsed.additions,
      binary: parsed.binary,
      committed: !paths.some((rel) => dirty.has(rel)),
      deletions: parsed.deletions,
      hunks: cut.hunks,
      oldPath: entry.oldPath,
      path: entry.path,
      preExisting: paths.some((rel) => baseline.has(rel)),
      status: entry.status,
      truncated: cut.truncated || preview.truncated,
    });
  }
  return {
    baseRevision: binding.startRevision,
    files,
    hash: snapshot.hash,
    head: snapshot.head,
    totals: {
      additions: files.reduce((sum, file) => sum + file.additions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
      files: files.length,
    },
  };
};

// -------------------------------------------------------------------- tree

const committedSnapshot = async (
  root: string,
  mode: ComparisonMode
): Promise<ReviewSnapshot> => {
  const [branch, head] = await Promise.all([
    currentBranch(root),
    headRevision(root),
  ]);
  return {
    branch,
    entries: [],
    hash: `view:${mode}:${head ?? "unborn"}`,
    head,
    index: "",
    status: [],
    tree: head ?? "",
  };
};

/** Display comparisons never change the mission-start review used for publishing. */
export const comparisonChanges = async (
  binding: WorkspaceBinding,
  mode: ComparisonMode
): Promise<Changes> => {
  const root = binding.path;
  const snapshot =
    mode === "uncommitted"
      ? await captureReview(binding)
      : await committedSnapshot(root, mode);
  const empty = await checkedGit(
    root,
    ["hash-object", "-w", "-t", "tree", "--stdin"],
    { input: "" }
  );
  const head = snapshot.head ?? empty;
  let from = head;
  let fromLabel = "HEAD";
  let toLabel = "Working tree";
  let mergeBase = false;
  if (mode === "last_commit") {
    if (!snapshot.head) {
      throw conflict("This repository has no commits to compare");
    }
    const parent = await git(root, ["rev-parse", "--verify", "HEAD^"]);
    from = parent.ok ? parent.stdout.trim() : empty;
    fromLabel = parent.ok ? "HEAD^" : "Empty tree";
    toLabel = "HEAD";
  }
  if (mode === "branch") {
    const remoteHead = await git(root, [
      "symbolic-ref",
      "--quiet",
      "refs/remotes/origin/HEAD",
    ]);
    const candidates = remoteHead.ok
      ? [remoteHead.stdout.trim()]
      : [
          "refs/remotes/origin/main",
          "refs/remotes/origin/master",
          "refs/heads/main",
          "refs/heads/master",
        ];
    const resolved = await Promise.all(
      candidates.map(async (ref) => {
        const result = await git(root, [
          "rev-parse",
          "--verify",
          "--end-of-options",
          `${ref}^{commit}`,
        ]);
        return result.ok ? ref : null;
      })
    );
    const defaultRef = resolved.find((ref) => ref !== null);
    if (!defaultRef || !snapshot.head) {
      throw conflict(
        "The default branch is unavailable locally. Fetch it before comparing."
      );
    }
    const mergeBaseRevision = await checkedGit(root, [
      "merge-base",
      defaultRef,
      snapshot.head,
    ]);
    from = mergeBaseRevision.trim();
    fromLabel = defaultRef.replace(/^refs\/(?:remotes|heads)\//u, "");
    toLabel = snapshot.branch ?? "HEAD";
    mergeBase = true;
  }
  const reviewed =
    mode === "uncommitted" ? snapshot : { ...snapshot, status: [], tree: head };
  const changes = await workspaceChanges(
    { ...binding, baselineDirtyFiles: [], startRevision: from },
    reviewed
  );
  return {
    ...changes,
    comparison: { from: fromLabel, mergeBase, mode, to: toLabel },
  };
};

const changeMap = async (binding: WorkspaceBinding) => {
  const map = new Map<string, ChangeKind>();
  if (binding.startRevision) {
    const names = await git(binding.path, [
      "-c",
      "core.quotePath=false",
      "diff",
      "--no-ext-diff",
      "-M",
      binding.startRevision,
      "--name-status",
      "-z",
      "--",
    ]);
    if (!names.ok) {
      throw badRequest("Could not read the mission change inventory");
    }
    for (const entry of parseNameStatus(names.stdout)) {
      map.set(entry.path, entry.status);
    }
  }
  const dirty = await status(binding.path);
  if (!dirty) {
    throw badRequest("Could not read the workspace status");
  }
  for (const entry of dirty) {
    map.set(entry.path, entry.code === "??" ? "untracked" : "modified");
  }
  return map;
};

export const listWorkspaceDir = async (
  binding: WorkspaceBinding,
  raw = ""
): Promise<FileTree> => {
  const target = await resolveWorkspacePath(binding.path, raw);
  if (!target.real) {
    throw badRequest("Folder not found");
  }
  const [allEntries, changes] = await Promise.all([
    readdir(target.real, { withFileTypes: true }),
    changeMap(binding),
  ]);
  const safeEntries = await mapReviewItems(allEntries, async (entry) => {
    if (!entry.isSymbolicLink()) {
      return entry;
    }
    const rel = target.rel ? `${target.rel}/${entry.name}` : entry.name;
    try {
      await resolveWorkspacePath(binding.path, rel);
      return entry;
    } catch {
      return null;
    }
  });
  const entries = safeEntries.filter((entry) => entry !== null);
  const changedDirs = new Set<string>();
  for (const changed of changes.keys()) {
    const parts = changed.split("/");
    for (let depth = 1; depth < parts.length; depth += 1) {
      changedDirs.add(parts.slice(0, depth).join("/"));
    }
  }
  const nodes: FileNode[] = entries
    .filter(
      (entry) =>
        entry.name !== ".git" &&
        (entry.isDirectory() || entry.isFile() || entry.isSymbolicLink())
    )
    .map((entry) => {
      const rel = target.rel ? `${target.rel}/${entry.name}` : entry.name;
      const type = entry.isDirectory()
        ? ("directory" as const)
        : ("file" as const);
      const dirChange = changedDirs.has(rel) ? "modified" : null;
      const change =
        type === "directory" ? dirChange : (changes.get(rel) ?? null);
      return { change, path: rel, type };
    })
    .toSorted((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1;
      }
      return a.path.localeCompare(b.path);
    });
  return {
    directory: target.rel,
    entries: nodes.slice(0, DIR_LIMIT),
    truncated: nodes.length > DIR_LIMIT,
  };
};
