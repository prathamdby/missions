import { constants } from "node:fs";
import {
  access,
  mkdir,
  readdir,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  checkedGit,
  updateIndex,
  withPrivateIndex,
} from "../files/review-snapshot";
import type { ReviewedEntry } from "../files/review-snapshot";
import { conflict } from "../lib/app-error";

export interface CandidateIntent {
  branch: string | null;
  expectedHead: string | null;
  tree: string;
  message: string;
  entries: ReviewedEntry[];
}

const quoteConfig = (value: string) =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n").replaceAll("\t", "\\t").replaceAll("\b", "\\b")}"`;

/** Freeze the existing effective values, including original gitdir/onbranch includes. */
const configuredValues = (raw: string) =>
  raw
    .split("\0")
    .filter(Boolean)
    .flatMap((record) => {
      const newline = record.indexOf("\n");
      const key = newline === -1 ? record : record.slice(0, newline);
      const first = key.indexOf(".");
      const last = key.lastIndexOf(".");
      const section = key.slice(0, first);
      if (section === "include" || section === "includeif") {
        return [];
      }
      const subsection =
        first === last ? "" : ` ${quoteConfig(key.slice(first + 1, last))}`;
      const value =
        newline === -1 ? "" : ` = ${quoteConfig(record.slice(newline + 1))}`;
      return [`[${section}${subsection}]\n\t${key.slice(last + 1)}${value}\n`];
    })
    .join("");

/** Preserve original hook argv[0]/relative helpers; only post-commit is deferred. */
const deferPostCommit = async (root: string, gitDir: string) => {
  const original = await checkedGit(root, [
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "hooks",
  ]);
  const hooks = path.join(gitDir, "hooks");
  await mkdir(hooks);
  const names = await readdir(original).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") {
        return [];
      }
      throw error;
    }
  );
  await Promise.all(
    names
      .filter((name) => name !== "post-commit")
      .map(async (name) => {
        const source = path.join(original, name);
        const info = await stat(source).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") {
              return null;
            }
            throw error;
          }
        );
        const target = path.join(hooks, name);
        let executable = false;
        try {
          await access(source, constants.X_OK);
          executable = true;
        } catch {
          // A symlink preserves Git's normal ignored/non-executable behavior.
        }
        if (info?.isFile() && executable) {
          const quoted = `'${source.replaceAll("'", "'\\''")}'`;
          // The effective original config is already frozen in the private repo.
          // Do not expose this dispatch-only -c override to the original hook.
          await writeFile(
            target,
            `#!/bin/sh\nunset GIT_CONFIG_PARAMETERS\nexec ${quoted} "$@"\n`,
            {
              mode: 0o700,
            }
          );
        } else {
          await symlink(source, target);
        }
      })
  );
  await writeFile(
    path.join(hooks, "post-commit"),
    "#!/bin/sh\n# Deferred until the approved real ref and index are installed.\nexit 0\n",
    { mode: 0o700 }
  );
  return hooks;
};

/**
 * Run Git's commit porcelain with native pre-commit/message hooks and signing.
 * Only post-commit is deferred; it must observe the installed real ref/index,
 * never this rejectable candidate. Effective identity/signing config is retained.
 */
export const createReviewedCandidate = (
  root: string,
  intent: CandidateIntent
) =>
  withPrivateIndex(async (index) => {
    const gitDir = path.join(path.dirname(index), "git");
    await mkdir(path.join(gitDir, "refs", "heads"), { recursive: true });
    const objects = await checkedGit(root, [
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      "objects",
    ]);
    const refs = await checkedGit(root, [
      "for-each-ref",
      "--format=%(objectname) %(refname)",
    ]);
    const configuration = await checkedGit(root, [
      "config",
      "--null",
      "--list",
      "--includes",
    ]);
    await Promise.all([
      symlink(objects, path.join(gitDir, "objects"), "dir"),
      writeFile(path.join(gitDir, "config"), configuredValues(configuration)),
      writeFile(path.join(gitDir, "packed-refs"), refs ? `${refs}\n` : ""),
      writeFile(
        path.join(gitDir, "HEAD"),
        intent.branch
          ? `ref: refs/heads/${intent.branch}\n`
          : `${intent.expectedHead}\n`
      ),
    ]);
    const hooks = await deferPostCommit(root, gitDir);
    if (intent.branch && intent.expectedHead) {
      const branchRef = path.join(gitDir, "refs", "heads", intent.branch);
      await mkdir(path.dirname(branchRef), { recursive: true });
      await writeFile(branchRef, `${intent.expectedHead}\n`);
    }
    const env = {
      GIT_COMMON_DIR: gitDir,
      // Values above already include these sources. Do not evaluate them a
      // second time against the isolated gitdir and duplicate multi-values.
      GIT_CONFIG_COUNT: "0",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_DIR: gitDir,
      GIT_INDEX_FILE: index,
      GIT_WORK_TREE: root,
    };
    await checkedGit(root, ["read-tree", intent.expectedHead ?? "--empty"], {
      env,
    });
    await updateIndex(root, index, intent.entries);
    await checkedGit(
      root,
      [
        "-c",
        `core.hooksPath=${hooks}`,
        "commit",
        "--quiet",
        "-m",
        intent.message,
      ],
      { env }
    );
    const sha = await checkedGit(root, ["rev-parse", "HEAD"], { env });
    const [tree, indexTree, parents, message] = await Promise.all([
      checkedGit(root, ["rev-parse", `${sha}^{tree}`], { env }),
      checkedGit(root, ["write-tree"], { env }),
      checkedGit(root, ["rev-list", "--parents", "-n", "1", sha], { env }),
      checkedGit(root, ["show", "-s", "--format=%s", sha], { env }),
    ]);
    const expectedParents = [sha, intent.expectedHead]
      .filter(Boolean)
      .join(" ");
    if (
      tree !== intent.tree ||
      indexTree !== intent.tree ||
      parents !== expectedParents
    ) {
      throw conflict(
        "A Git hook changed the reviewed candidate tree or parent; review the changes again"
      );
    }
    return { message, sha };
  });
