import { createHash } from "node:crypto";
import { lstat, open, readdir, stat } from "node:fs/promises";
import path from "node:path";

import type {
  Changes,
  DiffHunk,
  DiffLine,
  FileContent,
  FileDiff,
  FileNode,
  FileTree,
} from "@missions/protocol/files";
import type { WorkspaceBinding } from "@missions/protocol/workspaces";

import { canonical, head, isInside, status } from "../git/repo";
import { badRequest, forbidden } from "../lib/app-error";
import { git } from "../lib/exec";

export const TEXT_LIMIT = 512 * 1024;
const SNIFF_BYTES = 8192;
const UNTRACKED_LIMIT = 256 * 1024;
const FILE_LINE_BUDGET = 1500;
const TOTAL_LINE_BUDGET = 15_000;
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
  binding: WorkspaceBinding,
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
      } else {
        entry = { kind: "context", newNumber, oldNumber, text: line.slice(1) };
        oldNumber += 1;
        newNumber += 1;
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

const untrackedDiff = async (
  root: string,
  rel: string
): Promise<{ hex: string; parsed: ParsedPatch }> => {
  // Hash per file, not into the shared digest: these run concurrently and a
  // shared digest would make the review hash depend on I/O timing.
  const digest = createHash("sha256");
  const file = path.join(root, rel);
  const info = await lstat(file);
  digest.update(`${rel}\0${info.size}\0${info.mtimeMs}\0`);
  if (!info.isFile()) {
    return {
      hex: digest.digest("hex"),
      parsed: { additions: 0, binary: true, deletions: 0, hunks: [] },
    };
  }
  const buffer = await readHead(file, Math.min(info.size, UNTRACKED_LIMIT));
  digest.update(buffer);
  const empty = { additions: 0, binary: false, deletions: 0, hunks: [] };
  if (isBinary(buffer)) {
    return {
      hex: digest.digest("hex"),
      parsed: { ...empty, binary: true },
    };
  }
  const text = buffer.toString("utf-8");
  const lines = text.endsWith("\n")
    ? text.slice(0, -1).split("\n")
    : text.split("\n");
  if (text === "") {
    return { hex: digest.digest("hex"), parsed: empty };
  }
  return {
    hex: digest.digest("hex"),
    parsed: parseHunkLines([
      `@@ -0,0 +1,${lines.length} @@`,
      ...lines.map((line) => `+${line}`),
    ]),
  };
};

const budget = (parsed: ParsedPatch, remaining: number) => {
  const limit = Math.min(FILE_LINE_BUDGET, remaining);
  let used = 0;
  const hunks: DiffHunk[] = [];
  for (const hunk of parsed.hunks) {
    if (used >= limit) {
      break;
    }
    const lines = hunk.lines.slice(0, limit - used);
    used += lines.length;
    hunks.push({ header: hunk.header, lines });
  }
  const total = parsed.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0);
  return { hunks, truncated: used < total, used };
};

const untrackedPaths = async (root: string) => {
  const result = await git(root, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ]);
  return result.ok ? result.stdout.split("\0").filter(Boolean) : [];
};

/**
 * Everything that differs from the mission's start revision, including
 * untracked files. The hash binds a commit approval to exactly this review.
 */
export const workspaceChanges = async (
  binding: WorkspaceBinding
): Promise<Changes> => {
  const root = binding.path;
  const base = binding.startRevision;
  const digest = createHash("sha256");
  const currentHead = await head(root);
  digest.update(`${base ?? ""}\0${currentHead ?? ""}\0`);
  let tracked: NameStatus[] = [];
  let patches: string[][] = [];
  if (base) {
    const args = [
      "-c",
      "core.quotePath=false",
      "diff",
      "--no-color",
      "--no-ext-diff",
      "-M",
      base,
    ];
    const [names, patch] = await Promise.all([
      git(root, [...args, "--name-status", "-z", "--"]),
      git(root, [...args, "--unified=3", "--"]),
    ]);
    tracked = names.ok ? parseNameStatus(names.stdout) : [];
    patches = patch.ok ? splitPatch(patch.stdout) : [];
    digest.update(names.stdout);
    digest.update(patch.stdout);
  }
  const [untracked, dirtyEntries] = await Promise.all([
    untrackedPaths(root),
    status(root),
  ]);
  const dirty = new Set(
    (dirtyEntries ?? []).flatMap((entry) =>
      entry.oldPath ? [entry.path, entry.oldPath] : [entry.path]
    )
  );
  const baseline = new Set(binding.baselineDirtyFiles);
  let remaining = TOTAL_LINE_BUDGET;
  const files: FileDiff[] = [];
  for (const [index, entry] of tracked.entries()) {
    const parsed = parseHunkLines(
      patches.length === tracked.length ? (patches[index] ?? []) : []
    );
    const cut = budget(parsed, remaining);
    remaining -= cut.used;
    files.push({
      additions: parsed.additions,
      binary: parsed.binary,
      committed: !dirty.has(entry.path),
      deletions: parsed.deletions,
      hunks: cut.hunks,
      oldPath: entry.oldPath,
      path: entry.path,
      preExisting: baseline.has(entry.path),
      status: entry.status,
      truncated: cut.truncated,
    });
  }
  // Promise.all preserves input order, so the digest updates stay ordered.
  const untrackedDiffs = await Promise.all(
    untracked.map(async (rel) => ({
      ...(await untrackedDiff(root, rel)),
      rel,
    }))
  );
  for (const { hex, parsed, rel } of untrackedDiffs) {
    digest.update(hex);
    const cut = budget(parsed, remaining);
    remaining -= cut.used;
    files.push({
      additions: parsed.additions,
      binary: parsed.binary,
      committed: false,
      deletions: 0,
      hunks: cut.hunks,
      oldPath: null,
      path: rel,
      preExisting: baseline.has(rel),
      status: "untracked",
      truncated: cut.truncated,
    });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return {
    baseRevision: base,
    files,
    hash: digest.digest("hex"),
    head: currentHead,
    totals: {
      additions: files.reduce((sum, file) => sum + file.additions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
      files: files.length,
    },
  };
};

// -------------------------------------------------------------------- tree

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
    for (const entry of names.ok ? parseNameStatus(names.stdout) : []) {
      map.set(entry.path, entry.status);
    }
  }
  for (const rel of await untrackedPaths(binding.path)) {
    map.set(rel, "untracked");
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
  const [entries, changes] = await Promise.all([
    readdir(target.real, { withFileTypes: true }),
    changeMap(binding),
  ]);
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
