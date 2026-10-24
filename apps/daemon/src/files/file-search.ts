import { readdir } from "node:fs/promises";
import path from "node:path";

import type { FileMatch } from "@missions/protocol/composer";

import { git } from "../lib/exec";

const CACHE_MS = 30_000;
const MAX_FILES = 50_000;
const MAX_ROOTS = 128;
const MAX_DEPTH = 20;
const MAX_RESULTS = 50;

const safePath = (value: string) =>
  value !== "" &&
  !path.posix.isAbsolute(value) &&
  !value.split("/").some((part) => part === ".." || part === ".git");

const walk = async (root: string): Promise<string[]> => {
  const files: string[] = [];
  const pending = [{ depth: 0, directory: "" }];
  let visited = 0;
  const visitNext = async (): Promise<void> => {
    if (visited >= MAX_FILES) {
      return;
    }
    const current = pending.pop();
    if (!current) {
      return;
    }
    const entries = await readdir(path.join(root, current.directory), {
      withFileTypes: true,
    });
    for (const entry of entries) {
      visited += 1;
      if (visited > MAX_FILES) {
        break;
      }
      if (entry.name === ".git") {
        continue;
      }
      const relative = path.posix.join(current.directory, entry.name);
      if (entry.isDirectory() && current.depth < MAX_DEPTH) {
        pending.push({ depth: current.depth + 1, directory: relative });
      } else if (entry.isFile()) {
        files.push(relative);
      }
    }
    await visitNext();
  };
  await visitNext();
  return files;
};

const list = async (root: string): Promise<FileMatch[]> => {
  const result = await git(
    root,
    ["ls-files", "-co", "--exclude-standard", "-z"],
    { timeoutMs: 10_000 }
  );
  const paths = result.ok
    ? result.stdout.split("\0").slice(0, MAX_FILES)
    : await walk(root);
  const matches = new Map<string, FileMatch>();
  for (const file of paths) {
    if (!safePath(file)) {
      continue;
    }
    matches.set(file, { kind: "file", path: file });
    const parts = file.split("/");
    parts.pop();
    while (parts.length > 0) {
      const folder = `${parts.join("/")}/`;
      matches.set(folder, { kind: "folder", path: folder });
      parts.pop();
    }
  }
  return [...matches.values()];
};

const subsequence = (query: string, value: string) => {
  let cursor = 0;
  for (const character of value) {
    if (character === query[cursor]) {
      cursor += 1;
    }
  }
  return cursor === query.length;
};

const rank = (query: string, match: FileMatch) => {
  const value = match.path.toLowerCase().replace(/\/$/u, "");
  const basename = path.posix.basename(value);
  if (basename.startsWith(query)) {
    return 0;
  }
  if (value.includes(query)) {
    return 1;
  }
  return subsequence(query, value) ? 2 : null;
};

export class FileSearch {
  readonly #cache = new Map<
    string,
    { expires: number; value: Promise<FileMatch[]> }
  >();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  async search(root: string, rawQuery: string): Promise<FileMatch[]> {
    const key = path.resolve(root);
    let entry = this.#cache.get(key);
    if (!entry || entry.expires <= this.#now()) {
      const value = list(key);
      entry = { expires: this.#now() + CACHE_MS, value };
      this.#cache.set(key, entry);
      if (this.#cache.size > MAX_ROOTS) {
        const oldest = this.#cache.keys().next().value;
        if (oldest !== undefined) {
          this.#cache.delete(oldest);
        }
      }
      value.catch(() => {
        if (this.#cache.get(key)?.value === value) {
          this.#cache.delete(key);
        }
      });
    }
    const query = rawQuery.toLowerCase();
    const matches = await entry.value;
    return matches
      .map((match) => ({ match, rank: rank(query, match) }))
      .filter(
        (candidate): candidate is { match: FileMatch; rank: number } =>
          candidate.rank !== null
      )
      .toSorted(
        (a, b) =>
          a.rank - b.rank ||
          a.match.path.length - b.match.path.length ||
          a.match.path.localeCompare(b.match.path)
      )
      .slice(0, MAX_RESULTS)
      .map((candidate) => candidate.match);
  }
}
