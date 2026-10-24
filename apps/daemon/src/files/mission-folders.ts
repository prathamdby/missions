import { readdir, rm } from "node:fs/promises";
import path from "node:path";

import { badRequest } from "../lib/app-error";
import { errorMessage } from "../lib/async";

const UUID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu;

export const removeMissionFolder = async (root: string, missionId: string) => {
  if (
    !missionId ||
    missionId === "." ||
    missionId === ".." ||
    path.basename(missionId) !== missionId
  ) {
    throw badRequest("Invalid mission folder");
  }
  await rm(path.join(root, missionId), { force: true, recursive: true });
};

/** Receipts, not the absence of a mission row, authorize crash recovery cleanup. */
export const sweepMissionFolders = async (
  root: string,
  deleted: ReadonlySet<string>
) => {
  const entries = await readdir(root, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  );
  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          UUID.test(entry.name) &&
          deleted.has(entry.name)
      )
      .map(async (entry) => {
        try {
          await removeMissionFolder(root, entry.name);
        } catch (error) {
          process.stderr.write(
            `Mission folder cleanup failed: ${errorMessage(error)}\n`
          );
        }
      })
  );
};
