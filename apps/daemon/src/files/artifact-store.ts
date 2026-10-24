import { randomUUID } from "node:crypto";
import { copyFile, mkdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import type { Artifact } from "@missions/protocol/missions";

import { badRequest, forbidden } from "../lib/app-error";
import { removeMissionFolder, sweepMissionFolders } from "./mission-folders";
import { mediaTypeOf } from "./workspace-files";

export const ARTIFACT_LIMIT = 50 * 1024 * 1024;

const kindOf = (mediaType: string): Artifact["kind"] => {
  if (mediaType.startsWith("image/")) {
    return "image";
  }
  return mediaType.startsWith("video/") ? "recording" : "file";
};

const safeExtension = (name: string) => {
  const ext = path.extname(name).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/u.test(ext) ? ext : "";
};

/**
 * Copies agent-produced files out of the workspace so previews survive later
 * edits and cleanup. Files are only ever addressed by registered artifact ID.
 */
export class ArtifactStore {
  readonly #dir: string;

  constructor(dir: string) {
    this.#dir = dir;
  }

  async remove(missionId: string) {
    await removeMissionFolder(this.#dir, missionId);
  }

  async sweepRemoved(deleted: ReadonlySet<string>) {
    await sweepMissionFolders(this.#dir, deleted);
  }

  filePath(artifact: Pick<Artifact, "id" | "missionId" | "name">) {
    return path.join(
      this.#dir,
      artifact.missionId,
      `${artifact.id}${safeExtension(artifact.name)}`
    );
  }

  async import(input: {
    missionId: string;
    agentId: string | null;
    source: string;
    name: string;
    createdAt: string;
  }): Promise<Artifact> {
    const source = await realpath(input.source);
    if (source.split(path.sep).includes(".git")) {
      throw forbidden("Git internals cannot be attached");
    }
    const info = await stat(source);
    if (!info.isFile()) {
      throw badRequest("Only files can be attached");
    }
    if (info.size > ARTIFACT_LIMIT) {
      throw badRequest("The file is larger than 50 MB");
    }
    const mediaType = mediaTypeOf(input.name);
    const artifact: Artifact = {
      agentId: input.agentId,
      createdAt: input.createdAt,
      id: randomUUID(),
      kind: kindOf(mediaType),
      mediaType,
      missionId: input.missionId,
      name: path.basename(input.name).slice(0, 200),
      size: info.size,
    };
    const target = this.filePath(artifact);
    await mkdir(path.dirname(target), { mode: 0o700, recursive: true });
    await copyFile(source, target);
    return artifact;
  }
}
