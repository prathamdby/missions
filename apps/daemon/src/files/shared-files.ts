import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { FileTree } from "@missions/protocol/files";

import { badRequest } from "../lib/app-error";
import { removeMissionFolder, sweepMissionFolders } from "./mission-folders";
import { readWorkspaceFile, resolveWorkspacePath } from "./workspace-files";

const DIRECTORIES = ["plans", "handoffs", "results", "errors"] as const;
const LIMIT = 2000;

/** Durable mission knowledge, deliberately outside the repository checkout. */
export class SharedFiles {
  readonly #dir: string;
  readonly #ready = new Map<string, Promise<void>>();

  constructor(dir: string) {
    this.#dir = dir;
  }

  root(missionId: string) {
    return path.join(this.#dir, missionId);
  }

  async ensure(missionId: string) {
    let ready = this.#ready.get(missionId);
    if (!ready) {
      ready = this.#initialize(missionId);
      this.#ready.set(missionId, ready);
      void ready.catch(() => this.#ready.delete(missionId));
    }
    await ready;
  }

  /** Drops the in-memory readiness cache; the files themselves stay on disk. */
  forget(missionId: string) {
    this.#ready.delete(missionId);
  }

  async remove(missionId: string) {
    await this.#ready.get(missionId);
    this.forget(missionId);
    await removeMissionFolder(this.#dir, missionId);
  }

  async sweepRemoved(deleted: ReadonlySet<string>) {
    await sweepMissionFolders(this.#dir, deleted);
  }

  async #initialize(missionId: string) {
    const root = this.root(missionId);
    await mkdir(root, { mode: 0o700, recursive: true });
    await Promise.all(
      DIRECTORIES.map(async (dir) => {
        await resolveWorkspacePath(root, dir);
        await mkdir(path.join(root, dir), { mode: 0o700, recursive: true });
      })
    );
    await Promise.all(
      (
        [
          [
            "AGENTS.md",
            "# Mission shared files\n\nKeep plans, handoffs, results, and errors here. These files survive pauses and workspace cleanup. Repository edits belong in the working directory.\n",
          ],
          [
            "CREW.md",
            "# Crew\n\nThe Orchestrator coordinates the mission. Workers own bounded assignments and write handoffs in handoffs/.\n",
          ],
        ] as const
      ).map(async ([name, content]) => {
        try {
          await writeFile(path.join(root, name), content, {
            flag: "wx",
            mode: 0o600,
          });
        } catch (error) {
          if (
            !(
              error instanceof Error &&
              "code" in error &&
              error.code === "EEXIST"
            )
          ) {
            throw error;
          }
        }
      })
    );
  }

  async write(missionId: string, name: string, content: string) {
    await this.ensure(missionId);
    await resolveWorkspacePath(this.root(missionId), path.dirname(name));
    const target = await resolveWorkspacePath(this.root(missionId), name);
    await writeFile(target.real ?? target.abs, content, { mode: 0o600 });
  }

  async list(missionId: string, dir: string): Promise<FileTree> {
    await this.ensure(missionId);
    const target = await resolveWorkspacePath(this.root(missionId), dir);
    if (!target.real) {
      return { directory: target.rel, entries: [], truncated: false };
    }
    const entries = await readdir(target.real, { withFileTypes: true });
    const safe = entries.filter(
      (entry) => entry.isDirectory() || entry.isFile()
    );
    return {
      directory: target.rel,
      entries: safe.slice(0, LIMIT).map((entry) => ({
        change: null,
        path: target.rel ? `${target.rel}/${entry.name}` : entry.name,
        type: entry.isDirectory() ? "directory" : "file",
      })),
      truncated: safe.length > LIMIT,
    };
  }

  async read(missionId: string, name: string) {
    if (!name) {
      throw badRequest("A file path is required");
    }
    await this.ensure(missionId);
    return await readWorkspaceFile({ path: this.root(missionId) }, name);
  }
}
