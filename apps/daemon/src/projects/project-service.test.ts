import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { openDatabase } from "../db/database";
import { OperationJournal } from "../db/journal";
import { Store } from "../db/store";
import { EventLog } from "../events/event-log";
import * as repo from "../git/repo";
import * as execution from "../lib/exec";
import { gitRepo, tempDir } from "../test/fixtures";
import { ProjectService } from "./project-service";

const opened: { service: ProjectService; close: () => void }[] = [];

const setup = async () => {
  const database = openDatabase(":memory:");
  const store = new Store(database);
  const log = new EventLog(store);
  const journal = new OperationJournal(store, log);
  const reposDir = await tempDir("clone-destinations");
  const service = new ProjectService({ journal, log, reposDir, store });
  opened.push({ close: database.close, service });
  return { journal, reposDir, service, store };
};

describe(ProjectService, () => {
  afterEach(async () => {
    await Promise.all(
      opened.splice(0).map(async ({ service, close }) => {
        await service.shutdown();
        close();
      })
    );
    vi.restoreAllMocks();
  });

  it("admits an operation before awaits and replays concurrent clone requests", async () => {
    const { service, journal } = await setup();
    const source = await gitRepo();
    const request = {
      operationId: "same-clone",
      source: { kind: "url" as const, url: source },
    };
    const [first, second] = await Promise.all([
      service.clone(request),
      service.clone(request),
    ]);
    expect(first.id).toBe(second.id);
    await vi.waitFor(() =>
      expect(service.getCloneJob(first.id).status).toBe("succeeded")
    );
    expect(journal.get(request.operationId)?.operation.status).toBe(
      "succeeded"
    );
  });

  it("exclusively reserves one destination and never removes the winning clone", async () => {
    const { service } = await setup();
    const source = await gitRepo();
    const [first, second] = await Promise.all([
      service.clone({
        operationId: "first-clone",
        source: { kind: "url", url: source },
      }),
      service.clone({
        operationId: "second-clone",
        source: { kind: "url", url: source },
      }),
    ]);
    await vi.waitFor(() => {
      expect(
        [
          service.getCloneJob(first.id).status,
          service.getCloneJob(second.id).status,
        ].toSorted()
      ).toStrictEqual(["failed", "succeeded"]);
    });
    const failed = [first, second]
      .map((job) => service.getCloneJob(job.id))
      .find((job) => job.status === "failed");
    expect(failed?.error?.code).toBe("destination_exists");
    await expect(
      readFile(path.join(first.destination, "README.md"), "utf-8")
    ).resolves.toBe("hello\n");
  });

  it("keeps existing destinations and replacement directories after clone failure", async () => {
    const { service, reposDir } = await setup();
    await mkdir(path.join(reposDir, "existing"));
    await writeFile(path.join(reposDir, "existing", "mine.txt"), "mine");
    const existing = await service.clone({
      operationId: "existing-clone",
      source: { kind: "github", repo: "o/existing" },
    });
    await vi.waitFor(() =>
      expect(service.getCloneJob(existing.id).status).toBe("failed")
    );
    expect(
      existsSync(path.join(existing.destination, "mine.txt"))
    ).toBeTruthy();
    const original = execution.run;
    vi.spyOn(execution, "run").mockImplementation(
      async (file, args, options) => {
        if (file !== "gh") {
          return await original(file, args, options);
        }
        const destination = String(args[3]);
        await rename(destination, `${destination}-original`);
        await mkdir(destination);
        await writeFile(path.join(destination, "replacement"), "not owned");
        return {
          code: 1,
          missing: false,
          ok: false,
          stderr: "clone failed",
          stdout: "",
        };
      }
    );
    const replaced = await service.clone({
      operationId: "replaced-clone",
      source: { kind: "github", repo: "o/replaced" },
    });
    await vi.waitFor(() =>
      expect(service.getCloneJob(replaced.id).status).toBe("failed")
    );
    expect(
      existsSync(path.join(replaced.destination, "replacement"))
    ).toBeTruthy();
  });

  it("shutdown cancels and settles jobs before persistence can close", async () => {
    const { service, journal } = await setup();
    const source = await gitRepo();
    const job = await service.clone({
      operationId: "shutdown-clone",
      source: { kind: "url", url: source },
    });
    await service.shutdown();
    expect(service.getCloneJob(job.id).status).toBe("failed");
    expect(journal.get("shutdown-clone")?.operation.status).toBe("failed");
    await expect(
      service.clone({
        operationId: "after-shutdown",
        source: { kind: "url", url: source },
      })
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("fails closed when checkout or worktree status cannot be read", async () => {
    const { service } = await setup();
    const dir = await gitRepo();
    const added = await service.addLocal({
      operationId: "add-status",
      path: dir,
    });
    if (added.status !== "added") {
      throw new Error("Project not added");
    }
    await writeFile(path.join(dir, ".git", "index"), "corrupt index");
    await expect(service.checkout(added.project.id)).rejects.toMatchObject({
      code: "conflict",
    });
    await expect(repo.worktrees(dir)).rejects.toMatchObject({
      code: "conflict",
    });
  });
});
