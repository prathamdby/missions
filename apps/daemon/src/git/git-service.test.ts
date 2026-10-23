import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { ChangesSchema } from "@missions/protocol/files";
import { routes } from "@missions/protocol/routes";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDaemon } from "../daemon";
import type { Daemon } from "../daemon";
import * as execution from "../lib/exec";
import type { RuntimeHandle } from "../missions/mission-service";
import { NativeQueueTracker } from "../sdk/native-queue";
import { gitRepo, sh, tempDir, testConfig } from "../test/fixtures";
import { githubRepository } from "./git-service";

const opened: Daemon[] = [];

const idleRuntime = (): RuntimeHandle => ({
  addContext: () => Promise.resolve(),
  changeMode: () => Promise.resolve(),
  close: () => Promise.resolve({ stopped: true, survivors: [] }),
  edit: () => Promise.resolve("replaced"),
  interrupt: () => Promise.resolve(),
  model: null,
  queue: new NativeQueueTracker(() => null),
  remove: () => Promise.resolve("removed"),
  sessionId: "s",
  setInteractionMode: () => Promise.resolve(),
  start: () =>
    Promise.resolve({
      cwd: null,
      messages: [],
      pendingIds: [],
      queuedIds: [],
      sessionId: "s",
      workingState: "idle",
    }),
  submit: () => Promise.resolve(),
  updateModel: (choice) => Promise.resolve(choice),
});

const FAKE_GH = (dir: string) => `#!/usr/bin/env node
const fs = require("fs");
const D = ${JSON.stringify(dir)};
const args = process.argv.slice(2);
fs.appendFileSync(D + "/calls.log", JSON.stringify(args) + "\\n");
const state = () => JSON.parse(fs.readFileSync(D + "/prs.json", "utf8"));
if (args[0] === "pr" && args[1] === "list") {
  console.log(JSON.stringify(state()));
} else if (args[0] === "pr" && args[1] === "create") {
  const prs = state();
  const value = (flag) => args[args.indexOf(flag) + 1];
  const head = require("child_process").execFileSync("git", ["rev-parse", "HEAD"], {encoding:"utf8"}).trim();
  const pr = { number: 7, url: "https://github.com/o/r/pull/7", state: "OPEN", isDraft: true, updatedAt: new Date().toISOString(), headRefOid: head, headRefName: value("--head"), baseRefName: value("--base"), isCrossRepository: false, statusCheckRollup: [] };
  prs.push(pr);
  fs.writeFileSync(D + "/prs.json", JSON.stringify(prs));
  console.log(pr.url);
} else if (args[0] === "pr" && args[1] === "view") {
  console.log(JSON.stringify(state()[0]));
} else {
  process.exit(1);
}
`;

const setup = async (
  mode: "new_worktree" | "current_checkout" = "new_worktree",
  userFile?: string
) => {
  const repoDir = await gitRepo();
  if (userFile) {
    await writeFile(path.join(repoDir, userFile), "the user's draft\n");
  }
  const bare = path.join(await tempDir("remote"), "origin.git");
  execFileSync("git", ["clone", "-q", "--bare", repoDir, bare]);
  sh(repoDir, ["remote", "add", "origin", bare]);
  sh(repoDir, ["fetch", "-q", "origin"]);
  const ghDir = await tempDir("gh");
  await writeFile(path.join(ghDir, "prs.json"), "[]");
  await writeFile(path.join(ghDir, "gh"), FAKE_GH(ghDir));
  await chmod(path.join(ghDir, "gh"), 0o755);
  const daemon = await createDaemon({
    config: await testConfig(),
    createRuntime: idleRuntime,
    ghPath: path.join(ghDir, "gh"),
    version: "test",
  });
  opened.push(daemon);
  const added = await daemon.projects.addLocal({
    operationId: "add-project-1",
    path: repoDir,
  });
  if (added.status !== "added") {
    throw new Error("not added");
  }
  const snapshot = await daemon.missions.create({
    goal: "Publish a change",
    operationId: "create-mission-1",
    projectId: added.project.id,
    workspace:
      mode === "new_worktree"
        ? { baseBranch: "main", mode }
        : { acknowledgeDirty: userFile !== undefined, mode },
  });
  const missionId = snapshot.mission.id;
  const workspace = snapshot.mission.workspace?.path ?? "";
  await daemon.missions.pause(missionId, {
    expectedRevision: daemon.missions.get(missionId).revision,
    operationId: "pause-mission-1",
  });
  const headers = {
    authorization: `Bearer ${daemon.token}`,
    host: "127.0.0.1:4317",
  };
  const review = async () => {
    const res = await daemon.app.request(routes.changes(missionId), {
      headers,
    });
    return ChangesSchema.parse(await res.json());
  };
  const calls = async () => {
    const log = await readFile(path.join(ghDir, "calls.log"), "utf-8").catch(
      () => ""
    );
    return log.split("\n").filter(Boolean);
  };
  return { bare, calls, daemon, ghDir, missionId, repoDir, review, workspace };
};

const commitAll = async (
  ctx: Awaited<ReturnType<typeof setup>>,
  operationId: string
) => {
  const changes = await ctx.review();
  return await ctx.daemon.publish.commit(ctx.missionId, {
    expectedChangesHash: changes.hash,
    expectedHead: changes.head,
    message: "Add greeting",
    operationId,
  });
};

const writeHook = async (
  ctx: Awaited<ReturnType<typeof setup>>,
  name: string,
  body: string
) => {
  const file = path.join(ctx.repoDir, ".git", "hooks", name);
  await writeFile(file, `#!/bin/sh\nset -eu\n${body}\n`);
  await chmod(file, 0o755);
};

/** An independent observer must not discover the candidate's private Git state. */
const outsideGit = (root: string, args: string[]) =>
  `env ${[
    "GIT_DIR",
    "GIT_COMMON_DIR",
    "GIT_INDEX_FILE",
    "GIT_WORK_TREE",
    "GIT_CONFIG_PARAMETERS",
    "GIT_CONFIG_COUNT",
    "GIT_CONFIG_GLOBAL",
    "GIT_CONFIG_SYSTEM",
  ]
    .map((name) => `-u ${name}`)
    .join(
      " "
    )} git -C ${JSON.stringify(root)} ${args.map((arg) => JSON.stringify(arg)).join(" ")}`;

const interruptIndexInstallation = () => {
  const original = execution.git;
  let interrupted = false;
  vi.spyOn(execution, "git").mockImplementation(async (cwd, args, options) => {
    const result = await original(cwd, args, options);
    if (
      !interrupted &&
      args[0] === "update-ref" &&
      args.includes("missions: reviewed commit") &&
      result.ok
    ) {
      interrupted = true;
      throw new Error("Injected interruption after the commit ref CAS");
    }
    return result;
  });
};

const simulateUnknown = (
  daemon: Daemon,
  id: string,
  kind: string,
  missionId: string,
  detail: Record<string, unknown> = {}
) => {
  const at = new Date().toISOString();
  daemon.store.putOperation(
    {
      createdAt: at,
      detail,
      id,
      kind,
      missionId,
      status: "intent",
      updatedAt: at,
    },
    null
  );
  daemon.journal.recoverInterrupted();
};

describe("publish lifecycle", () => {
  afterEach(async () => {
    await Promise.all(opened.splice(0).map((daemon) => daemon.close()));
    vi.restoreAllMocks();
  });

  it("reviews and commits path-aware clean filters while binding all original bytes", async () => {
    const ctx = await setup();
    sh(ctx.workspace, [
      "config",
      "filter.fixture.clean",
      "tr '[:lower:]' '[:upper:]'",
    ]);
    sh(ctx.workspace, ["config", "filter.fixture.required", "true"]);
    await writeFile(
      path.join(ctx.workspace, ".gitattributes"),
      "*.clean filter=fixture text eol=lf\n"
    );
    await writeFile(path.join(ctx.workspace, "hello.clean"), "review me\r\n");
    const first = await ctx.review();
    await writeFile(path.join(ctx.workspace, "hello.clean"), "REVIEW ME\r\n");
    const second = await ctx.review();
    await commitAll(ctx, "filtered-commit");
    expect(first.hash).not.toBe(second.hash);
    expect(
      second.files.find((file) => file.path === "hello.clean")?.hunks[0]
        ?.lines[0]?.text
    ).toBe("REVIEW ME");
    expect(
      execFileSync("git", ["show", "HEAD:hello.clean"], {
        cwd: ctx.workspace,
        encoding: "utf-8",
      })
    ).toBe("REVIEW ME\n");
    expect(sh(ctx.workspace, ["status", "--porcelain"])).toBe("");
  });

  it("honors core.autocrlf without rereading mutable bytes during staging", async () => {
    const ctx = await setup();
    sh(ctx.workspace, ["config", "core.autocrlf", "true"]);
    await writeFile(path.join(ctx.workspace, "windows.txt"), "windows\r\n");
    await commitAll(ctx, "eol-commit");
    expect(
      execFileSync("git", ["show", "HEAD:windows.txt"], {
        cwd: ctx.workspace,
        encoding: "utf-8",
      })
    ).toBe("windows\n");
    await expect(
      readFile(path.join(ctx.workspace, "windows.txt"), "utf-8")
    ).resolves.toBe("windows\r\n");
    expect(sh(ctx.workspace, ["status", "--porcelain"])).toBe("");
  });

  it("runs native pre-hooks against the candidate and post-commit against the installed real repository", async () => {
    const ctx = await setup("current_checkout", "user.txt");
    sh(ctx.workspace, ["add", "user.txt"]);
    const staged = sh(ctx.workspace, ["ls-files", "--stage", "user.txt"]);
    const identity = sh(ctx.workspace, ["log", "-1", "--format=%an <%ae>"]);
    const log = path.join(ctx.ghDir, "hooks.log");
    await Promise.all([
      writeHook(
        ctx,
        "pre-commit",
        `. "$(dirname "$0")/hook-helper"\nprintf 'pre-commit:%s\\n' "$(git diff --cached --name-only)" >> ${JSON.stringify(log)}`
      ),
      writeHook(
        ctx,
        "prepare-commit-msg",
        `printf 'prepare-commit-msg:%s\\n' "$2" >> ${JSON.stringify(log)}\nprintf 'Prepared greeting\\n' > "$1"`
      ),
      writeHook(
        ctx,
        "commit-msg",
        `printf 'commit-msg\\n' >> ${JSON.stringify(log)}\nprintf '\\nValidated\\n' >> "$1"`
      ),
      writeHook(
        ctx,
        "post-commit",
        `printf 'post-commit:%s:%s\\n' "$(${outsideGit(ctx.workspace, ["rev-parse", "HEAD"])})" "$(${outsideGit(ctx.workspace, ["diff", "--cached", "--name-only"])})" >> ${JSON.stringify(log)}\nprintf 'post-config:%s\\n' "$(git config core.hooksPath)" >> ${JSON.stringify(log)}`
      ),
    ]);
    const hooks = await tempDir("configured hooks'");
    await writeFile(
      path.join(hooks, "hook-helper"),
      `printf 'helper:%s\\n' "$(git config core.hooksPath)" >> ${JSON.stringify(log)}\n`
    );
    await Promise.all(
      ["pre-commit", "prepare-commit-msg", "commit-msg", "post-commit"].map(
        (name) =>
          rename(
            path.join(ctx.repoDir, ".git", "hooks", name),
            path.join(hooks, name)
          )
      )
    );
    sh(ctx.workspace, ["config", "core.hooksPath", hooks]);
    await writeFile(path.join(ctx.workspace, "hello.txt"), "approved\n");
    const result = await commitAll(ctx, "hooked-commit");
    const sha = sh(ctx.workspace, ["rev-parse", "HEAD"]);
    const phases = await readFile(log, "utf-8");
    expect(phases.trim().split("\n")).toStrictEqual([
      `helper:${hooks}`,
      "pre-commit:hello.txt",
      "prepare-commit-msg:message",
      "commit-msg",
      `post-commit:${sha}:user.txt`,
      `post-config:${hooks}`,
    ]);
    expect({
      identity: sh(ctx.workspace, ["log", "-1", "--format=%an <%ae>"]),
      message: sh(ctx.workspace, ["log", "-1", "--format=%B"]),
      projected: result.publish.commits[0]?.message,
      staged: sh(ctx.workspace, ["ls-files", "--stage", "user.txt"]),
    }).toStrictEqual({
      identity,
      message: "Prepared greeting\n\nValidated",
      projected: "Prepared greeting",
      staged,
    });
  });

  it("preserves relative hooksPath and onbranch configuration in both native phases", async () => {
    const ctx = await setup();
    const hooks = path.join(await tempDir("relative-hooks"), "hooks");
    await mkdir(hooks);
    const relative = path.relative(ctx.workspace, hooks);
    const branch = sh(ctx.workspace, ["branch", "--show-current"]);
    const configuration = path.join(ctx.ghDir, "branch-hooks.config");
    const log = path.join(ctx.ghDir, "branch-hooks.log");
    await writeFile(
      configuration,
      `[core]\nhooksPath = ${JSON.stringify(relative)}\n[fixture]\nphase = original\n`
    );
    sh(ctx.workspace, [
      "config",
      `includeIf.onbranch:${branch}.path`,
      configuration,
    ]);
    await writeHook(
      ctx,
      "pre-commit",
      `printf 'pre:%s:%s\\n' "$(git config fixture.phase)" "$(git config core.hooksPath)" >> ${JSON.stringify(log)}`
    );
    await writeHook(
      ctx,
      "post-commit",
      `printf 'post:%s:%s:%s\\n' "$(${outsideGit(ctx.workspace, ["rev-parse", "HEAD"])})" "$(git config fixture.phase)" "$PWD" >> ${JSON.stringify(log)}`
    );
    await Promise.all(
      ["pre-commit", "post-commit"].map((name) =>
        rename(
          path.join(ctx.repoDir, ".git", "hooks", name),
          path.join(hooks, name)
        )
      )
    );
    await writeFile(path.join(ctx.workspace, "hello.txt"), "approved\n");
    await commitAll(ctx, "branch-config-hooks");
    await expect(readFile(log, "utf-8")).resolves.toBe(
      `pre:original:${relative}\npost:${sh(ctx.workspace, ["rev-parse", "HEAD"])}:original:${ctx.workspace}\n`
    );
  });

  it.each(["pre-commit", "prepare-commit-msg", "commit-msg"])(
    "rejects unreviewed candidate bytes staged by %s",
    async (hook) => {
      const ctx = await setup();
      const before = sh(ctx.workspace, ["rev-parse", "HEAD"]);
      const postLog = path.join(ctx.ghDir, "rejected-post.log");
      await writeHook(
        ctx,
        "post-commit",
        `printf 'post\\n' >> ${JSON.stringify(postLog)}`
      );
      await writeHook(
        ctx,
        hook,
        "printf 'not reviewed\\n' > intruder.txt\ngit add -- intruder.txt"
      );
      await writeFile(path.join(ctx.workspace, "hello.txt"), "approved\n");
      await expect(commitAll(ctx, `smuggled-${hook}`)).rejects.toThrow(
        /hook changed the reviewed candidate/u
      );
      expect(sh(ctx.workspace, ["rev-parse", "HEAD"])).toBe(before);
      expect({
        cached: sh(ctx.workspace, ["diff", "--cached", "--name-only"]),
        postRan: existsSync(postLog),
      }).toStrictEqual({ cached: "", postRan: false });
    }
  );

  it.each(["original index", "ref CAS", "installation"])(
    "never invokes post-commit when %s rejects installation",
    async (reason) => {
      const ctx = await setup();
      const before = sh(ctx.workspace, ["rev-parse", "HEAD"]);
      const branch = sh(ctx.workspace, ["symbolic-ref", "HEAD"]);
      const log = path.join(ctx.ghDir, "install-hooks.log");
      await writeHook(
        ctx,
        "pre-commit",
        `printf 'pre\\n' >> ${JSON.stringify(log)}`
      );
      await writeHook(
        ctx,
        "post-commit",
        `printf 'post\\n' >> ${JSON.stringify(log)}`
      );
      await writeFile(path.join(ctx.workspace, "hello.txt"), "approved\n");
      const original = execution.git;
      let expectedHead = before;
      vi.spyOn(execution, "git").mockImplementation(
        async (cwd, args, options) => {
          if (
            args[0] === "update-ref" &&
            args.includes("missions: reviewed commit")
          ) {
            if (reason === "installation") {
              throw new Error("Injected installation failure");
            }
            if (reason === "ref CAS") {
              expectedHead = sh(ctx.workspace, [
                "commit-tree",
                `${before}^{tree}`,
                "-p",
                before,
                "-m",
                "External ref update",
              ]);
              sh(ctx.workspace, ["update-ref", branch, expectedHead, before]);
            }
          }
          const result = await original(cwd, args, options);
          if (
            reason === "original index" &&
            args.includes("commit") &&
            args.includes("--quiet") &&
            result.ok
          ) {
            await writeFile(
              path.join(ctx.workspace, "late.txt"),
              "user staging\n"
            );
            sh(ctx.workspace, ["add", "late.txt"]);
          }
          return result;
        }
      );
      await expect(
        commitAll(ctx, `rejected-${reason.replaceAll(" ", "-")}`)
      ).rejects.toThrow(
        /index moved|cannot lock ref|Injected installation failure/u
      );
      expect({
        head: sh(ctx.workspace, ["rev-parse", "HEAD"]),
        log: await readFile(log, "utf-8"),
      }).toStrictEqual({ head: expectedHead, log: "pre\n" });
    }
  );

  it.each([0, 7])(
    "preserves bytes staged by post-commit exit %s without committing them",
    async (code) => {
      const ctx = await setup();
      const log = path.join(ctx.ghDir, "staging-post.log");
      await writeHook(
        ctx,
        "post-commit",
        `printf 'post\\n' >> ${JSON.stringify(log)}\nprintf 'not reviewed\\n' > intruder.txt\ngit add -- intruder.txt\nexit ${code}`
      );
      await writeFile(path.join(ctx.workspace, "hello.txt"), "approved\n");
      const operationId = `post-stages-${code}`;
      const result = await commitAll(ctx, operationId);
      await ctx.daemon.publish.commit(ctx.missionId, {
        expectedChangesHash: "stale",
        expectedHead: null,
        message: "not a new commit",
        operationId,
      });
      const sha = sh(ctx.workspace, ["rev-parse", "HEAD"]);
      expect({
        cached: sh(ctx.workspace, ["diff", "--cached", "--name-only"]),
        committed: sh(ctx.workspace, ["ls-tree", "--name-only", "HEAD"]),
        hookLog: await readFile(log, "utf-8"),
        projected: result.publish.commits,
        tree: sh(ctx.workspace, ["rev-parse", "HEAD^{tree}"]),
      }).toStrictEqual({
        cached: "intruder.txt",
        committed: "README.md\nhello.txt",
        hookLog: "post\n",
        projected: [{ message: "Add greeting", sha }],
        tree: ctx.daemon.journal.get(operationId)?.operation.detail.tree,
      });
      expect(
        ctx.daemon.journal.get(`${operationId}:post-commit`)?.operation.status
      ).toBe(code === 0 ? "succeeded" : "failed");
    }
  );

  it("does not rerun an uncertain external post-commit hook on retry", async () => {
    const ctx = await setup();
    const log = path.join(ctx.ghDir, "uncertain-post.log");
    await writeHook(
      ctx,
      "pre-commit",
      `printf 'pre\\n' >> ${JSON.stringify(log)}`
    );
    await writeHook(
      ctx,
      "post-commit",
      `printf 'post\\n' >> ${JSON.stringify(log)}`
    );
    await writeFile(path.join(ctx.workspace, "hello.txt"), "approved\n");
    const original = execution.git;
    vi.spyOn(execution, "git").mockImplementation(
      async (cwd, args, options) => {
        const result = await original(cwd, args, options);
        if (args[0] === "hook" && args.includes("post-commit")) {
          throw new Error("Injected loss of the post-commit outcome");
        }
        return result;
      }
    );
    await expect(commitAll(ctx, "uncertain-post")).rejects.toThrow(
      /Injected loss/u
    );
    await expect(
      ctx.daemon.publish.commit(ctx.missionId, {
        expectedChangesHash: "ignored",
        expectedHead: null,
        message: "ignored",
        operationId: "uncertain-post",
      })
    ).rejects.toThrow(/outcome is unknown.*not be run again/u);
    expect({
      commit: ctx.daemon.journal.get("uncertain-post")?.operation.status,
      hook: ctx.daemon.journal.get("uncertain-post:post-commit")?.operation
        .status,
      log: await readFile(log, "utf-8"),
    }).toStrictEqual({
      commit: "unknown",
      hook: "unknown",
      log: "pre\npost\n",
    });
  });

  it("recovers an installed commit after a local pre-hook-dispatch lookup fails", async () => {
    const ctx = await setup();
    const log = path.join(ctx.ghDir, "dispatch-lookup.log");
    await writeHook(
      ctx,
      "pre-commit",
      `printf 'pre\\n' >> ${JSON.stringify(log)}`
    );
    await writeHook(
      ctx,
      "post-commit",
      `printf 'post\\n' >> ${JSON.stringify(log)}`
    );
    await writeFile(path.join(ctx.workspace, "hello.txt"), "approved\n");
    const original = execution.git;
    let installed = false;
    let failedRead = false;
    vi.spyOn(execution, "git").mockImplementation(
      async (cwd, args, options) => {
        const result = await original(cwd, args, options);
        if (
          args[0] === "update-ref" &&
          args.includes("missions: reviewed commit") &&
          result.ok
        ) {
          installed = true;
        }
        if (
          installed &&
          !failedRead &&
          args[0] === "rev-parse" &&
          args.at(-1) === "index"
        ) {
          failedRead = true;
          return {
            ...result,
            code: 1,
            ok: false,
            stderr: "Injected index path lookup failure",
          };
        }
        return result;
      }
    );
    await expect(commitAll(ctx, "dispatch-lookup")).rejects.toThrow(
      /Injected index path/u
    );
    expect(ctx.daemon.journal.get("dispatch-lookup")?.operation.status).toBe(
      "unknown"
    );
    await expect(readFile(log, "utf-8")).resolves.toBe("pre\n");
    await ctx.daemon.publish.commit(ctx.missionId, {
      expectedChangesHash: "ignored",
      expectedHead: null,
      message: "ignored",
      operationId: "dispatch-lookup",
    });
    await expect(readFile(log, "utf-8")).resolves.toBe("pre\npost\n");
  });

  it("never accepts a post-commit hook that moves HEAD onto an unreviewed tree", async () => {
    const ctx = await setup();
    const log = path.join(ctx.ghDir, "mutating-post.log");
    await writeHook(
      ctx,
      "post-commit",
      `printf 'post\\n' >> ${JSON.stringify(log)}\nprintf 'unreviewed\\n' > intruder.txt\ngit add -- intruder.txt\nnext=$(git commit-tree "$(git write-tree)" -p HEAD -m 'Hook commit')\ngit update-ref HEAD "$next"`
    );
    await writeFile(path.join(ctx.workspace, "hello.txt"), "approved\n");
    await expect(commitAll(ctx, "mutating-post")).rejects.toThrow(
      /approved tree changed/u
    );
    await expect(
      ctx.daemon.publish.commit(ctx.missionId, {
        expectedChangesHash: "ignored",
        expectedHead: null,
        message: "ignored",
        operationId: "mutating-post",
      })
    ).rejects.toThrow(/outcome is unknown.*not be run again/u);
    expect({
      hook: ctx.daemon.journal.get("mutating-post:post-commit")?.operation
        .status,
      log: await readFile(log, "utf-8"),
      published: ctx.daemon.missions.get(ctx.missionId).publish.commits,
    }).toStrictEqual({ hook: "unknown", log: "post\n", published: [] });
  });

  it("honors a configured rejecting pre-commit hook", async () => {
    const ctx = await setup();
    const before = sh(ctx.workspace, ["rev-parse", "HEAD"]);
    await writeHook(
      ctx,
      "pre-commit",
      "printf 'fixture rejection\\n' >&2\nexit 1"
    );
    await writeFile(path.join(ctx.workspace, "hello.txt"), "approved\n");
    await expect(commitAll(ctx, "rejected-hook")).rejects.toThrow(
      /fixture rejection/u
    );
    expect(sh(ctx.workspace, ["rev-parse", "HEAD"])).toBe(before);
  });

  it("honors commit.gpgsign through a deterministic configured SSH signing adapter", async () => {
    const ctx = await setup();
    const program = path.join(ctx.ghDir, "signing-adapter");
    const key = path.join(ctx.ghDir, "fixture-key");
    const log = path.join(ctx.ghDir, "signing.log");
    await writeFile(key, "fixture adapter key; not a real key\n");
    await writeFile(
      program,
      `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");
fs.writeFileSync(args.at(-1) + ".sig", "-----BEGIN SSH SIGNATURE-----\\nfixture-signature\\n-----END SSH SIGNATURE-----\\n");
`
    );
    await chmod(program, 0o755);
    const configuration = path.join(ctx.ghDir, "signing.config");
    await writeFile(
      configuration,
      `[gpg]\nformat = ssh\n[gpg "ssh"]\nprogram = ${JSON.stringify(program)}\n[user]\nsigningkey = ${JSON.stringify(key)}\n[commit]\ngpgsign = true\n`
    );
    sh(ctx.workspace, [
      "config",
      `includeIf.gitdir:${path.join(ctx.repoDir, ".git")}/.path`,
      configuration,
    ]);
    await writeFile(path.join(ctx.workspace, "signed.txt"), "approved\n");
    await commitAll(ctx, "signed-commit");
    expect(sh(ctx.workspace, ["cat-file", "-p", "HEAD"])).toContain(
      "gpgsig -----BEGIN SSH SIGNATURE-----\n fixture-signature"
    );
    const signingCalls = await readFile(log, "utf-8");
    expect(JSON.parse(signingCalls.trim())).toContain(key);
    expect(sh(ctx.workspace, ["config", "commit.gpgsign"])).toBe("true");
  });

  it("restores origin upstream configuration after pushing an immutable SHA", async () => {
    const ctx = await setup();
    const sha = sh(ctx.workspace, ["rev-parse", "HEAD"]);
    const branch = sh(ctx.workspace, ["branch", "--show-current"]);
    await ctx.daemon.publish.push(ctx.missionId, {
      expectedHead: sha,
      operationId: "upstream-push",
    });
    expect({
      merge: sh(ctx.workspace, ["config", `branch.${branch}.merge`]),
      remote: sh(ctx.workspace, ["config", `branch.${branch}.remote`]),
      upstream: sh(ctx.workspace, [
        "rev-parse",
        "--symbolic-full-name",
        "@{upstream}",
      ]),
      upstreamSha: sh(ctx.workspace, ["rev-parse", "@{upstream}"]),
    }).toStrictEqual({
      merge: `refs/heads/${branch}`,
      remote: "origin",
      upstream: `refs/remotes/origin/${branch}`,
      upstreamSha: sha,
    });
  });

  it("repairs journaled selected index entries after a crash following ref installation", async () => {
    const ctx = await setup("current_checkout", "user.txt");
    sh(ctx.workspace, ["add", "user.txt"]);
    const staged = sh(ctx.workspace, ["ls-files", "--stage", "user.txt"]);
    const hookLog = path.join(ctx.ghDir, "once.log");
    const postLog = path.join(ctx.ghDir, "recovered-post.log");
    await writeHook(
      ctx,
      "pre-commit",
      `printf 'once\\n' >> ${JSON.stringify(hookLog)}`
    );
    await writeHook(
      ctx,
      "post-commit",
      `printf '%s:%s\\n' "$(${outsideGit(ctx.workspace, ["rev-parse", "HEAD"])})" "$(${outsideGit(ctx.workspace, ["rev-parse", ":hello.txt"])})" >> ${JSON.stringify(postLog)}`
    );
    await writeFile(path.join(ctx.workspace, "hello.txt"), "approved\n");
    interruptIndexInstallation();
    await expect(commitAll(ctx, "repair-index")).rejects.toThrow(
      /Injected interruption/u
    );
    expect(existsSync(postLog)).toBeFalsy();
    const sha = sh(ctx.workspace, ["rev-parse", "HEAD"]);
    const result = await ctx.daemon.publish.commit(ctx.missionId, {
      expectedChangesHash: "changed retry",
      expectedHead: null,
      message: "changed retry",
      operationId: "repair-index",
    });
    await ctx.daemon.publish.commit(ctx.missionId, {
      expectedChangesHash: "second retry",
      expectedHead: null,
      message: "second retry",
      operationId: "repair-index",
    });
    expect({
      cached: sh(ctx.workspace, ["diff", "--cached", "--name-only"]),
      head: sh(ctx.workspace, ["rev-parse", "HEAD"]),
      hookLog: await readFile(hookLog, "utf-8"),
      postLog: await readFile(postLog, "utf-8"),
      selected: sh(ctx.workspace, ["rev-parse", ":hello.txt"]),
      staged: sh(ctx.workspace, ["ls-files", "--stage", "user.txt"]),
    }).toStrictEqual({
      cached: "user.txt",
      head: sha,
      hookLog: "once\n",
      postLog: `${sha}:${sh(ctx.workspace, ["rev-parse", "HEAD:hello.txt"])}\n`,
      selected: sh(ctx.workspace, ["rev-parse", "HEAD:hello.txt"]),
      staged,
    });
    expect(result.publish.commits).toStrictEqual([
      { message: "Add greeting", sha },
    ]);
    expect(ctx.daemon.journal.get("repair-index")?.operation.status).toBe(
      "reconciled"
    );
  });

  it.each([0, 7])(
    "preserves post-hook staging after exit %s when the parent result was lost",
    async (code) => {
      const ctx = await setup();
      const log = path.join(ctx.ghDir, "settled-post.log");
      await writeHook(
        ctx,
        "pre-commit",
        `printf 'pre\\n' >> ${JSON.stringify(log)}`
      );
      await writeHook(
        ctx,
        "post-commit",
        `printf 'post\\n' >> ${JSON.stringify(log)}\nprintf 'post-hook staging\\n' > intruder.txt\ngit add -- intruder.txt\nexit ${code}`
      );
      await writeFile(path.join(ctx.workspace, "hello.txt"), "approved\n");
      const original = ctx.daemon.store.putOperation.bind(ctx.daemon.store);
      vi.spyOn(ctx.daemon.store, "putOperation").mockImplementation(
        (operation, result) => {
          if (
            operation.id === "lost-parent-result" &&
            operation.status === "succeeded"
          ) {
            throw new Error("Injected loss of the parent result");
          }
          return original(operation, result);
        }
      );
      await expect(commitAll(ctx, "lost-parent-result")).rejects.toThrow(
        /Injected loss/u
      );
      const result = await ctx.daemon.publish.commit(ctx.missionId, {
        expectedChangesHash: "ignored",
        expectedHead: null,
        message: "ignored",
        operationId: "lost-parent-result",
      });
      expect({
        cached: sh(ctx.workspace, ["diff", "--cached", "--name-only"]),
        log: await readFile(log, "utf-8"),
        postStatus: ctx.daemon.journal.get("lost-parent-result:post-commit")
          ?.operation.status,
        published: result.publish.commits,
        status: ctx.daemon.journal.get("lost-parent-result")?.operation.status,
      }).toStrictEqual({
        cached: "intruder.txt",
        log: "pre\npost\n",
        postStatus: code === 0 ? "succeeded" : "failed",
        published: [
          {
            message: "Add greeting",
            sha: sh(ctx.workspace, ["rev-parse", "HEAD"]),
          },
        ],
        status: "reconciled",
      });
    }
  );

  it("does not repair over user staging that diverged after an interrupted ref installation", async () => {
    const ctx = await setup("current_checkout", "user.txt");
    sh(ctx.workspace, ["add", "user.txt"]);
    await writeFile(path.join(ctx.workspace, "hello.txt"), "approved\n");
    interruptIndexInstallation();
    await expect(commitAll(ctx, "divergent-index")).rejects.toThrow(
      /Injected interruption/u
    );
    await writeFile(path.join(ctx.workspace, "user.txt"), "new user staging\n");
    sh(ctx.workspace, ["add", "user.txt"]);
    await expect(
      ctx.daemon.publish.commit(ctx.missionId, {
        expectedChangesHash: "ignored",
        expectedHead: null,
        message: "ignored",
        operationId: "divergent-index",
      })
    ).rejects.toMatchObject({ code: "stale_revision" });
    expect(sh(ctx.workspace, ["show", ":user.txt"])).toBe("new user staging");
    expect(ctx.daemon.journal.get("divergent-index")?.operation.status).toBe(
      "unknown"
    );
  });

  it("observes completed folder/ref removal after interruption without retrying deletion", async () => {
    const ctx = await setup();
    const branch = sh(ctx.workspace, ["branch", "--show-current"]);
    const original = execution.git;
    const destructive: string[][] = [];
    vi.spyOn(execution, "git").mockImplementation(
      async (cwd, args, options) => {
        const result = await original(cwd, args, options);
        if (
          (args[0] === "worktree" && args[1] === "remove") ||
          (args[0] === "update-ref" && args[1] === "-d")
        ) {
          destructive.push([...args]);
        }
        if (args[0] === "update-ref" && args[1] === "-d" && result.ok) {
          throw new Error(
            "Injected interruption after folder and branch removal"
          );
        }
        return result;
      }
    );
    await expect(
      ctx.daemon.publish.cleanup(ctx.missionId, {
        action: "remove",
        operationId: "recover-removal",
      })
    ).rejects.toThrow(/Injected interruption/u);
    const recovered = await ctx.daemon.publish.cleanup(ctx.missionId, {
      action: "keep",
      operationId: "recover-removal",
    });
    expect([
      recovered.status,
      recovered.publish.cleanup,
      existsSync(ctx.workspace),
      destructive.length,
    ]).toStrictEqual(["archived", "removed", false, 2]);
    expect(sh(ctx.repoDir, ["branch", "--list", branch])).toBe("");
    expect(ctx.daemon.journal.get("recover-removal")?.operation.status).toBe(
      "reconciled"
    );
  });

  it("recovers archived unknown cleanup after metadata settlement was interrupted", async () => {
    const ctx = await setup();
    const original = ctx.daemon.missions.patch.bind(ctx.daemon.missions);
    let interrupted = false;
    vi.spyOn(ctx.daemon.missions, "patch").mockImplementation((id, update) => {
      const result = original(id, update);
      if (
        !interrupted &&
        result.status === "archived" &&
        result.publish.cleanup === "removed"
      ) {
        interrupted = true;
        throw new Error("Injected interruption after cleanup metadata");
      }
      return result;
    });
    await expect(
      ctx.daemon.publish.cleanup(ctx.missionId, {
        action: "remove",
        operationId: "archived-recovery",
      })
    ).rejects.toThrow(/Injected interruption/u);
    const recovered = await ctx.daemon.publish.cleanup(ctx.missionId, {
      action: "remove",
      operationId: "archived-recovery",
    });
    expect([
      recovered.status,
      recovered.publish.cleanup,
      ctx.daemon.journal.get("archived-recovery")?.operation.status,
    ]).toStrictEqual(["archived", "removed", "reconciled"]);
  });

  it.each(["kind", "mission"])(
    "rejects wrong cleanup operation %s before entering recovery",
    async (mismatch) => {
      const ctx = await setup();
      simulateUnknown(
        ctx.daemon,
        "wrong-cleanup-id",
        mismatch === "kind" ? "git.push" : "workspace.cleanup",
        mismatch === "mission" ? "another-mission" : ctx.missionId
      );
      const recovery = vi.spyOn(ctx.daemon.missions, "withWorkspaceRecovery");
      expect(() =>
        ctx.daemon.publish.cleanup(ctx.missionId, {
          action: "remove",
          operationId: "wrong-cleanup-id",
        })
      ).toThrow(/different action or mission/u);
      expect(recovery).not.toHaveBeenCalled();
      expect(existsSync(ctx.workspace)).toBeTruthy();
    }
  );

  it("does not infer completed cleanup from a missing folder while its exact branch remains", async () => {
    const ctx = await setup();
    const branch = sh(ctx.workspace, ["branch", "--show-current"]);
    const head = sh(ctx.workspace, ["rev-parse", "HEAD"]);
    const original = execution.git;
    vi.spyOn(execution, "git").mockImplementation(
      async (cwd, args, options) => {
        const result = await original(cwd, args, options);
        if (args[0] === "worktree" && args[1] === "remove" && result.ok) {
          throw new Error("Injected interruption before branch removal");
        }
        return result;
      }
    );
    await expect(
      ctx.daemon.publish.cleanup(ctx.missionId, {
        action: "remove",
        operationId: "partial-removal",
      })
    ).rejects.toThrow(/Injected interruption/u);
    await expect(
      ctx.daemon.publish.cleanup(ctx.missionId, {
        action: "remove",
        operationId: "partial-removal",
      })
    ).rejects.toMatchObject({ code: "conflict" });
    expect({
      branch: sh(ctx.repoDir, ["rev-parse", `refs/heads/${branch}`]),
      cleanup: ctx.daemon.missions.get(ctx.missionId).publish.cleanup,
      status: ctx.daemon.journal.get("partial-removal")?.operation.status,
    }).toStrictEqual({ branch: head, cleanup: "none", status: "unknown" });
  });

  it("requires the original exact OID when recovery observes an intentionally retained branch", async () => {
    const ctx = await setup();
    await writeFile(path.join(ctx.workspace, "hello.txt"), "unmerged\n");
    await commitAll(ctx, "retained-branch-commit");
    const branch = sh(ctx.workspace, ["branch", "--show-current"]);
    const retained = sh(ctx.workspace, ["rev-parse", "HEAD"]);
    const base = sh(ctx.repoDir, ["rev-parse", "HEAD"]);
    const original = ctx.daemon.missions.patch.bind(ctx.daemon.missions);
    let interrupted = false;
    vi.spyOn(ctx.daemon.missions, "patch").mockImplementation((id, update) => {
      const result = original(id, update);
      if (
        !interrupted &&
        result.status === "archived" &&
        result.publish.cleanup === "removed"
      ) {
        interrupted = true;
        throw new Error("Injected interruption after retained-branch cleanup");
      }
      return result;
    });
    await expect(
      ctx.daemon.publish.cleanup(ctx.missionId, {
        action: "remove",
        operationId: "retained-recovery",
      })
    ).rejects.toThrow(/Injected interruption/u);
    sh(ctx.repoDir, ["update-ref", `refs/heads/${branch}`, base]);
    await expect(
      ctx.daemon.publish.cleanup(ctx.missionId, {
        action: "remove",
        operationId: "retained-recovery",
      })
    ).rejects.toMatchObject({ code: "conflict" });
    sh(ctx.repoDir, ["update-ref", `refs/heads/${branch}`, retained]);
    const recovered = await ctx.daemon.publish.cleanup(ctx.missionId, {
      action: "remove",
      operationId: "retained-recovery",
    });
    expect([
      recovered.status,
      recovered.publish.cleanup,
      sh(ctx.repoDir, ["rev-parse", `refs/heads/${branch}`]),
    ]).toStrictEqual(["archived", "removed", retained]);
  });

  it("normalizes HTTPS and SSH origins to credential-free repository selectors", () => {
    expect([
      githubRepository("git@github.com:owner/repo.git"),
      githubRepository("ssh://git@github.example/owner/repo.git"),
      githubRepository("https://token@github.com/owner/repo.git"),
    ]).toStrictEqual([
      "github.com/owner/repo",
      "github.example/owner/repo",
      "github.com/owner/repo",
    ]);
  });

  it("rejects a branch switch between snapshot capture and commit installation", async () => {
    const ctx = await setup();
    await writeFile(path.join(ctx.workspace, "hello.txt"), "approved\n");
    const before = sh(ctx.workspace, ["rev-parse", "HEAD"]);
    const original = ctx.daemon.journal.run.bind(ctx.daemon.journal);
    vi.spyOn(ctx.daemon.journal, "run").mockImplementation(
      async (spec, effect, options) => {
        if (spec.kind === "git.commit") {
          sh(ctx.workspace, ["switch", "-qc", "external-switch"]);
        }
        return await original(spec, effect, options);
      }
    );
    await expect(commitAll(ctx, "branch-switch-commit")).rejects.toMatchObject({
      code: "stale_revision",
    });
    expect(sh(ctx.workspace, ["rev-parse", "HEAD"])).toBe(before);
    expect(sh(ctx.workspace, ["branch", "--show-current"])).toBe(
      "external-switch"
    );
  });

  it("rejects an external index change without overwriting newly staged user work", async () => {
    const ctx = await setup();
    await writeFile(path.join(ctx.workspace, "hello.txt"), "approved\n");
    const before = sh(ctx.workspace, ["rev-parse", "HEAD"]);
    const original = ctx.daemon.journal.run.bind(ctx.daemon.journal);
    vi.spyOn(ctx.daemon.journal, "run").mockImplementation(
      async (spec, effect, options) => {
        if (spec.kind === "git.commit") {
          await writeFile(
            path.join(ctx.workspace, "external.txt"),
            "new staged content\n"
          );
          sh(ctx.workspace, ["add", "external.txt"]);
        }
        return await original(spec, effect, options);
      }
    );
    await expect(commitAll(ctx, "index-switch-commit")).rejects.toMatchObject({
      code: "stale_revision",
    });
    expect(sh(ctx.workspace, ["rev-parse", "HEAD"])).toBe(before);
    expect(sh(ctx.workspace, ["show", ":external.txt"])).toBe(
      "new staged content"
    );
  });

  it("reconciles the recorded exact commit SHA rather than matching a retry subject", async () => {
    const ctx = await setup();
    await writeFile(path.join(ctx.workspace, "hello.txt"), "approved\n");
    await commitAll(ctx, "commit-before-crash");
    const recorded = ctx.daemon.journal.get("commit-before-crash");
    const approvedSha = sh(ctx.workspace, ["rev-parse", "HEAD"]);
    simulateUnknown(
      ctx.daemon,
      "commit-reconcile",
      "git.commit",
      ctx.missionId,
      recorded?.operation.detail
    );
    const result = await ctx.daemon.publish.commit(ctx.missionId, {
      expectedChangesHash: "changed retry",
      expectedHead: null,
      message: "changed retry message",
      operationId: "commit-reconcile",
    });
    expect(result.publish.commits).toStrictEqual([
      { message: "Add greeting", sha: approvedSha },
    ]);
    expect(ctx.daemon.journal.get("commit-reconcile")?.operation.status).toBe(
      "reconciled"
    );
  });

  it("commits literal wildcard, bracket and colon names without staging excluded dirty paths", async () => {
    const ctx = await setup("current_checkout", "user.txt");
    await writeFile(path.join(ctx.workspace, "*.txt"), "literal star\n");
    await writeFile(path.join(ctx.workspace, "[x].txt"), "literal bracket\n");
    await writeFile(path.join(ctx.workspace, ":notes"), "literal colon\n");
    sh(ctx.workspace, ["add", "user.txt"]);
    const staged = sh(ctx.workspace, ["ls-files", "--stage", "user.txt"]);
    await commitAll(ctx, "literal-commit");
    expect(
      sh(ctx.workspace, ["show", "--format=", "--name-only"])
        .split("\n")
        .toSorted()
    ).toStrictEqual(["*.txt", ":notes", "[x].txt"]);
    expect(sh(ctx.workspace, ["ls-files", "--stage", "user.txt"])).toBe(staged);
    expect(sh(ctx.workspace, ["diff", "--cached", "--name-only"])).toBe(
      "user.txt"
    );
  });

  it("protects the original endpoint when a baseline dirty file is renamed later", async () => {
    const ctx = await setup("current_checkout", "README.md");
    sh(ctx.workspace, ["mv", "README.md", "moved.md"]);
    await writeFile(path.join(ctx.workspace, "hello.txt"), "mission\n");
    await commitAll(ctx, "rename-commit");
    const committed = sh(ctx.workspace, ["show", "--format=", "--name-only"]);
    expect(committed).not.toContain("moved.md");
    expect(committed).not.toContain("README.md");
    expect(sh(ctx.workspace, ["status", "--porcelain"])).toContain("moved.md");
  });

  it("commits captured approved bytes even if the worktree changes after validation", async () => {
    const ctx = await setup();
    await writeFile(path.join(ctx.workspace, "hello.txt"), "approved\n");
    const original = ctx.daemon.journal.run.bind(ctx.daemon.journal);
    vi.spyOn(ctx.daemon.journal, "run").mockImplementation(
      async (spec, effect, options) => {
        if (spec.kind === "git.commit") {
          await writeFile(
            path.join(ctx.workspace, "hello.txt"),
            "later edit\n"
          );
        }
        return await original(spec, effect, options);
      }
    );
    await commitAll(ctx, "immutable-commit");
    expect(sh(ctx.workspace, ["show", "HEAD:hello.txt"])).toBe("approved");
    await expect(
      readFile(path.join(ctx.workspace, "hello.txt"), "utf-8")
    ).resolves.toBe("later edit\n");
    expect(sh(ctx.workspace, ["diff", "--name-only"])).toBe("hello.txt");
  });

  it("pushes the approved SHA rather than resolving a moved symbolic HEAD", async () => {
    const ctx = await setup();
    await writeFile(path.join(ctx.workspace, "hello.txt"), "approved\n");
    await commitAll(ctx, "push-exact-commit");
    const approved = sh(ctx.workspace, ["rev-parse", "HEAD"]);
    sh(ctx.workspace, ["commit", "--allow-empty", "-qm", "later"]);
    const later = sh(ctx.workspace, ["rev-parse", "HEAD"]);
    sh(ctx.workspace, ["update-ref", "HEAD", approved]);
    const original = execution.git;
    const seen: string[][] = [];
    vi.spyOn(execution, "git").mockImplementation(
      async (cwd, args, options) => {
        if (args[0] === "push") {
          seen.push([...args]);
          sh(ctx.workspace, ["update-ref", "HEAD", later]);
        }
        return await original(cwd, args, options);
      }
    );
    await ctx.daemon.publish.push(ctx.missionId, {
      expectedHead: approved,
      operationId: "push-exact",
    });
    const branch = sh(ctx.workspace, ["branch", "--show-current"]);
    expect(seen[0]?.at(-1)).toBe(`${approved}:refs/heads/${branch}`);
    expect(sh(ctx.bare, ["rev-parse", `refs/heads/${branch}`])).toBe(approved);
    const replay = await ctx.daemon.publish.push(ctx.missionId, {
      expectedHead: later,
      operationId: "push-exact",
    });
    expect(replay.publish.pushedBranch).toBe(branch);
    expect(seen).toHaveLength(1);
  });

  it("leaves failed and absent remote evidence unknown and rejects identity reuse before reconciliation", async () => {
    const ctx = await setup();
    const branch = sh(ctx.workspace, ["branch", "--show-current"]);
    const head = sh(ctx.workspace, ["rev-parse", "HEAD"]);
    simulateUnknown(ctx.daemon, "unknown-evidence", "git.push", ctx.missionId, {
      branch,
      expectedHead: head,
      remote: ctx.bare,
    });
    await expect(
      ctx.daemon.publish.push(ctx.missionId, {
        expectedHead: head,
        operationId: "unknown-evidence",
      })
    ).rejects.toMatchObject({ code: "conflict" });
    await rename(ctx.bare, `${ctx.bare}-offline`);
    await expect(
      ctx.daemon.publish.push(ctx.missionId, {
        expectedHead: head,
        operationId: "unknown-evidence",
      })
    ).rejects.toThrow(/remote branch head/u);
    expect(ctx.daemon.journal.get("unknown-evidence")?.operation.status).toBe(
      "unknown"
    );
    simulateUnknown(ctx.daemon, "wrong-identity", "github.pr", ctx.missionId, {
      branch,
    });
    await expect(
      ctx.daemon.publish.push(ctx.missionId, {
        expectedHead: head,
        operationId: "wrong-identity",
      })
    ).rejects.toMatchObject({ code: "conflict" });
    expect(ctx.daemon.journal.get("wrong-identity")?.operation.status).toBe(
      "unknown"
    );
  });

  it("does not create a PR for an unapproved remote head or reconcile closed and mismatched PRs", async () => {
    const ctx = await setup();
    const head = sh(ctx.workspace, ["rev-parse", "HEAD"]);
    const branch = sh(ctx.workspace, ["branch", "--show-current"]);
    await ctx.daemon.publish.push(ctx.missionId, {
      expectedHead: head,
      operationId: "pr-remote-push",
    });
    const fake = {
      baseRefName: "main",
      headRefName: branch,
      headRefOid: head,
      isDraft: true,
      number: 8,
      state: "CLOSED",
      updatedAt: new Date().toISOString(),
      url: "https://github.com/o/r/pull/8",
    };
    await writeFile(
      path.join(ctx.ghDir, "prs.json"),
      JSON.stringify([
        fake,
        { ...fake, baseRefName: "other", number: 9, state: "OPEN" },
        { ...fake, headRefOid: "other", number: 10, state: "OPEN" },
        { ...fake, isCrossRepository: true, number: 11, state: "OPEN" },
      ])
    );
    simulateUnknown(
      ctx.daemon,
      "pr-closed-unknown",
      "github.pr",
      ctx.missionId,
      { base: "main", branch, expectedHead: head, remote: ctx.bare }
    );
    await expect(
      ctx.daemon.publish.createPullRequest(ctx.missionId, {
        body: "b",
        expectedHead: head,
        operationId: "pr-closed-unknown",
        title: "t",
      })
    ).rejects.toMatchObject({ code: "conflict" });
    expect(ctx.daemon.journal.get("pr-closed-unknown")?.operation.status).toBe(
      "unknown"
    );
    sh(ctx.bare, ["update-ref", "-d", `refs/heads/${branch}`]);
    await expect(
      ctx.daemon.publish.createPullRequest(ctx.missionId, {
        body: "b",
        expectedHead: head,
        operationId: "pr-wrong-remote",
        title: "t",
      })
    ).rejects.toMatchObject({ code: "stale_revision" });
    const calls = await ctx.calls();
    expect(calls.some((call) => call.includes('"create"'))).toBeFalsy();
  });

  it("holds mutation exclusion across checking, effects and settlement while resume waits", async () => {
    const ctx = await setup();
    await writeFile(path.join(ctx.workspace, "hello.txt"), "approved\n");
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const original = ctx.daemon.journal.run.bind(ctx.daemon.journal);
    vi.spyOn(ctx.daemon.journal, "run").mockImplementation(
      async (spec, effect, options) => {
        if (spec.kind === "git.commit") {
          entered.resolve(undefined);
          await release.promise;
        }
        return await original(spec, effect, options);
      }
    );
    const committing = commitAll(ctx, "serialized-commit");
    await entered.promise;
    let resumed = false;
    const resuming = ctx.daemon.missions
      .resume(ctx.missionId, {
        expectedRevision: ctx.daemon.missions.get(ctx.missionId).revision,
        operationId: "serialized-resume",
      })
      .then(
        () => {
          resumed = true;
          return resumed;
        },
        () => {
          resumed = true;
          return resumed;
        }
      );
    await Promise.resolve();
    expect(resumed).toBeFalsy();
    expect(ctx.daemon.missions.get(ctx.missionId).status).toBe("paused");
    release.resolve(undefined);
    await Promise.all([committing, resuming]);
    expect(sh(ctx.workspace, ["show", "HEAD:hello.txt"])).toBe("approved");
  });

  it("serializes cleanup behind an in-flight reviewed commit and replays removal", async () => {
    const ctx = await setup();
    await writeFile(path.join(ctx.workspace, "hello.txt"), "approved\n");
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const original = ctx.daemon.journal.run.bind(ctx.daemon.journal);
    vi.spyOn(ctx.daemon.journal, "run").mockImplementation(
      async (spec, effect, options) => {
        if (spec.kind === "git.commit") {
          entered.resolve(undefined);
          await release.promise;
        }
        return await original(spec, effect, options);
      }
    );
    const committing = commitAll(ctx, "cleanup-serialized-commit");
    await entered.promise;
    const removing = ctx.daemon.publish.cleanup(ctx.missionId, {
      action: "remove",
      operationId: "cleanup-serialized-remove",
    });
    release.resolve(undefined);
    const [, removed] = await Promise.all([committing, removing]);
    const replay = await ctx.daemon.publish.cleanup(ctx.missionId, {
      action: "keep",
      operationId: "cleanup-serialized-remove",
    });
    expect([
      removed.publish.cleanup,
      replay.publish.cleanup,
      existsSync(ctx.workspace),
    ]).toStrictEqual(["removed", "removed", false]);
  });

  it("merged refresh never archives a running mission during automatic cleanup", async () => {
    const ctx = await setup();
    const head = sh(ctx.workspace, ["rev-parse", "HEAD"]);
    await ctx.daemon.publish.push(ctx.missionId, {
      expectedHead: head,
      operationId: "live-push",
    });
    await ctx.daemon.publish.createPullRequest(ctx.missionId, {
      body: "b",
      expectedHead: head,
      operationId: "live-pr",
      title: "t",
    });
    ctx.daemon.settings.update({ cleanupAfterMerge: true });
    const prs = JSON.parse(
      await readFile(path.join(ctx.ghDir, "prs.json"), "utf-8")
    ) as Record<string, unknown>[];
    await writeFile(
      path.join(ctx.ghDir, "prs.json"),
      JSON.stringify(prs.map((pr) => ({ ...pr, state: "MERGED" })))
    );
    await ctx.daemon.missions.resume(ctx.missionId, {
      expectedRevision: ctx.daemon.missions.get(ctx.missionId).revision,
      operationId: "live-resume",
    });
    const refreshed = await ctx.daemon.publish.refreshPullRequest(
      ctx.missionId
    );
    expect(refreshed.status).not.toBe("archived");
    expect(refreshed.publish.pr?.state).toBe("merged");
    expect(existsSync(ctx.workspace)).toBeTruthy();
  });

  it("rejects stale reviews and commits once per operation", async () => {
    const ctx = await setup();
    await writeFile(path.join(ctx.workspace, "hello.txt"), "hi\n");
    const reviewed = await ctx.review();
    await writeFile(path.join(ctx.workspace, "hello.txt"), "hi again\n");
    await expect(
      ctx.daemon.publish.commit(ctx.missionId, {
        expectedChangesHash: reviewed.hash,
        expectedHead: reviewed.head,
        message: "x",
        operationId: "commit-stale-1",
      })
    ).rejects.toMatchObject({ code: "stale_revision" });
    const first = await commitAll(ctx, "commit-op-1");
    const again = await ctx.daemon.publish.commit(ctx.missionId, {
      expectedChangesHash: "ignored",
      expectedHead: null,
      message: "Add greeting",
      operationId: "commit-op-1",
    });
    expect([
      first.publish.commits.length,
      again.publish.commits.length,
    ]).toStrictEqual([1, 1]);
    expect(sh(ctx.workspace, ["rev-list", "--count", "HEAD"])).toBe("2");
  });

  it("leaves the user's earlier edits out of the commit unless they opt in", async () => {
    const ctx = await setup("current_checkout", "mine.txt");
    await writeFile(path.join(ctx.workspace, "hello.txt"), "hi\n");
    await commitAll(ctx, "commit-mission-1");
    const committed = sh(ctx.workspace, ["show", "--name-only", "--format="]);
    const status = sh(ctx.workspace, ["status", "--porcelain"]);
    await expect(commitAll(ctx, "commit-mission-2")).rejects.toThrow(
      /Only files changed before the mission/u
    );
    const remaining = await ctx.review();
    await ctx.daemon.publish.commit(ctx.missionId, {
      expectedChangesHash: remaining.hash,
      expectedHead: remaining.head,
      includePreExisting: true,
      message: "Include my draft",
      operationId: "commit-mission-3",
    });
    expect({
      committed,
      included: sh(ctx.workspace, ["show", "--name-only", "--format="]),
      status,
    }).toStrictEqual({
      committed: "hello.txt",
      included: "mine.txt",
      status: "?? mine.txt",
    });
  });

  it("reconciles an unknown push against the remote instead of pushing again", async () => {
    const ctx = await setup();
    await writeFile(path.join(ctx.workspace, "hello.txt"), "hi\n");
    await commitAll(ctx, "commit-op-2");
    const head = sh(ctx.workspace, ["rev-parse", "HEAD"]);
    const branch = sh(ctx.workspace, ["branch", "--show-current"]);
    sh(ctx.workspace, ["push", "-q", "origin", `HEAD:refs/heads/${branch}`]);
    simulateUnknown(ctx.daemon, "push-op-1", "git.push", ctx.missionId, {
      branch,
      expectedHead: head,
      remote: ctx.bare,
    });
    const mission = await ctx.daemon.publish.push(ctx.missionId, {
      expectedHead: "changed retry payload",
      operationId: "push-op-1",
    });
    expect(mission.publish.pushedBranch).toBe(branch);
    expect(ctx.daemon.journal.get("push-op-1")?.operation.status).toBe(
      "reconciled"
    );
    await expect(
      ctx.daemon.publish.push(ctx.missionId, {
        expectedHead: "0".repeat(40),
        operationId: "push-op-2",
      })
    ).rejects.toMatchObject({ code: "stale_revision" });
  });

  it("adopts a PR created before a crash and never opens a duplicate", async () => {
    const ctx = await setup();
    await writeFile(path.join(ctx.workspace, "hello.txt"), "hi\n");
    await commitAll(ctx, "commit-op-3");
    const head = sh(ctx.workspace, ["rev-parse", "HEAD"]);
    const branch = sh(ctx.workspace, ["branch", "--show-current"]);
    await ctx.daemon.publish.push(ctx.missionId, {
      expectedHead: head,
      operationId: "push-op-3",
    });
    await writeFile(
      path.join(ctx.ghDir, "prs.json"),
      JSON.stringify([
        {
          baseRefName: "main",
          headRefName: branch,
          headRefOid: head,
          isCrossRepository: false,
          isDraft: true,
          number: 9,
          state: "OPEN",
          statusCheckRollup: [],
          updatedAt: new Date().toISOString(),
          url: "https://github.com/o/r/pull/9",
        },
      ])
    );
    simulateUnknown(ctx.daemon, "pr-op-1", "github.pr", ctx.missionId, {
      base: "main",
      branch,
      expectedHead: head,
      remote: ctx.bare,
    });
    const adopted = await ctx.daemon.publish.createPullRequest(ctx.missionId, {
      body: "b",
      expectedHead: head,
      operationId: "pr-op-1",
      title: "t",
    });
    const fresh = await ctx.daemon.publish.createPullRequest(ctx.missionId, {
      body: "b",
      expectedHead: head,
      operationId: "pr-op-2",
      title: "t",
    });
    expect([
      adopted.publish.pr?.number,
      fresh.publish.pr?.number,
    ]).toStrictEqual([9, 9]);
    const calls = await ctx.calls();
    expect(calls.some((call) => call.includes('"create"'))).toBeFalsy();
  });

  it("keeps dirty or unowned folders and removes a clean merged worktree", async () => {
    const unowned = await setup("current_checkout");
    const kept = await unowned.daemon.publish.cleanup(unowned.missionId, {
      action: "remove",
      operationId: "cleanup-op-1",
    });
    expect([kept.publish.cleanup, existsSync(unowned.workspace)]).toStrictEqual(
      ["blocked", true]
    );
    const ctx = await setup();
    await writeFile(path.join(ctx.workspace, "scratch.txt"), "dirty\n");
    const dirty = await ctx.daemon.publish.cleanup(ctx.missionId, {
      action: "remove",
      operationId: "cleanup-op-2",
    });
    expect([
      dirty.publish.cleanup,
      dirty.publish.cleanupReason,
      existsSync(ctx.workspace),
    ]).toStrictEqual([
      "blocked",
      "The worktree has uncommitted changes, so it is kept",
      true,
    ]);
    await commitAll(ctx, "commit-op-4");
    const removed = await ctx.daemon.publish.cleanup(ctx.missionId, {
      action: "remove",
      operationId: "cleanup-op-3",
    });
    expect([
      removed.publish.cleanup,
      removed.status,
      existsSync(ctx.workspace),
    ]).toStrictEqual(["removed", "archived", false]);
  });
});
