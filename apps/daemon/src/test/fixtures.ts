import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadConfig } from "../config";
import type { DaemonConfig } from "../config";

export const tempDir = (prefix: string) =>
  mkdtemp(path.join(os.tmpdir(), `missions-${prefix}-`));

export const sh = (cwd: string, args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

/** A repository with one commit on `main`. */
export const gitRepo = async (name = "repo") => {
  const parent = await tempDir("fixture");
  const dir = path.join(parent, name);
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  await writeFile(path.join(dir, "README.md"), "hello\n");
  sh(dir, ["add", "README.md"]);
  sh(dir, ["commit", "-q", "-m", "init"]);
  return dir;
};

export const testConfig = async (): Promise<DaemonConfig> => {
  const home = await tempDir("home");
  return {
    ...loadConfig({ MISSIONS_HOME: home }),
    droidPath: "/nonexistent/droid",
  };
};
