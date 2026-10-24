import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";

import {
  ATTACHMENT_NAME_HEADER,
  AttachmentRefSchema,
  PDF_LIMIT,
} from "@missions/protocol/attachments";
import { QueueItemSchema } from "@missions/protocol/missions";
import { routes } from "@missions/protocol/routes";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Daemon } from "../daemon";
import { AttachmentStore } from "../files/attachment-store";
import {
  bootDaemon,
  control,
  startMission,
  waitFor,
  MODEL,
} from "../test/mission-harness";

const opened: Daemon[] = [];
describe("attachment delivery", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(opened.splice(0).map((daemon) => daemon.close()));
  });

  it("uploads raw bodies behind the boundary and serves inert sniffed content", async () => {
    const { daemon, config } = await bootDaemon(opened);
    const headers = {
      [ATTACHMENT_NAME_HEADER]: encodeURIComponent("../résumé.txt"),
      authorization: `Bearer ${daemon.token}`,
      host: `127.0.0.1:${config.port}`,
    };
    const denied = await daemon.app.request(routes.attachments(), {
      body: "hello",
      method: "POST",
    });
    const response = await daemon.app.request(routes.attachments(), {
      body: "safe text",
      headers: { ...headers, "content-type": "image/png" },
      method: "POST",
    });
    const ref = AttachmentRefSchema.parse(await response.json());
    const content = await daemon.app.request(routes.attachment(ref.id), {
      headers,
    });
    expect([denied.status, response.status, content.status]).toStrictEqual([
      403, 201, 200,
    ]);
    expect(ref).toMatchObject({
      kind: "text",
      mediaType: "text/plain",
      name: "résumé.txt",
    });
    expect({
      csp: content.headers.get("content-security-policy"),
      nosniff: content.headers.get("x-content-type-options"),
      type: content.headers.get("content-type"),
    }).toStrictEqual({
      csp: "default-src 'none'; sandbox",
      nosniff: "nosniff",
      type: "text/plain",
    });
    const oversized = await daemon.app.request(routes.attachments(), {
      body: new Uint8Array(PDF_LIMIT + 1),
      headers,
      method: "POST",
    });
    expect(oversized.status).toBe(400);
    await expect(content.text()).resolves.toBe("safe text");
  });

  it("keeps attachment identity on replay, edit and explicit retry without duplicating bytes", async () => {
    const ctx = await startMission(await bootDaemon(opened));
    const store = new AttachmentStore(ctx.config.attachmentsDir);
    const ref = await store.upload(
      "notes.txt",
      Buffer.from("original content")
    );
    const request = {
      attachmentIds: [ref.id],
      mode: "queue" as const,
      operationId: "files-message",
      text: "Read this",
    };
    const receipt = await ctx.daemon.missions.submitMessage(
      ctx.missionId,
      request
    );
    await waitFor(
      () => ctx.orchestrator.submitted.some((entry) => entry.id === receipt.id),
      Boolean
    );
    await expect(
      ctx.daemon.missions.submitMessage(ctx.missionId, request)
    ).resolves.toMatchObject({ id: receipt.id });
    await expect(
      ctx.daemon.missions.submitMessage(ctx.missionId, {
        ...request,
        attachmentIds: [],
      })
    ).rejects.toThrow(/operation/u);
    const item = ctx.daemon.store.queue.get(receipt.id) ?? receipt;
    await ctx.daemon.missions.editQueueItem(ctx.missionId, item.id, {
      expectedRevision: item.revision,
      operationId: "files-edit",
      text: "Read again",
    });
    const edited = ctx.daemon.store.queue.get("files-edit");
    expect(edited?.attachments).toStrictEqual([ref]);
    expect(
      ctx.orchestrator.submitted.find((entry) => entry.id === "files-edit")
        ?.options.files
    ).toStrictEqual([
      {
        data: "original content",
        mediaType: "text/plain",
        name: "notes.txt",
        type: "text",
      },
    ]);
    if (!edited) {
      throw new Error("Missing edit");
    }
    ctx.daemon.store.queue.put({ ...edited, state: "unknown" });
    const retry = await ctx.daemon.missions.retryQueueItem(
      ctx.missionId,
      edited.id,
      { expectedRevision: edited.revision, operationId: "files-retry" }
    );
    expect(retry.attachments).toStrictEqual([ref]);
  });

  it("binds goal attachments before committing and rejects changed creation IDs", async () => {
    const ctx = await startMission(await bootDaemon(opened));
    const store = new AttachmentStore(ctx.config.attachmentsDir);
    const ref = await store.upload("goal.txt", Buffer.from("goal evidence"));
    const request = {
      attachmentIds: [ref.id],
      goal: "Inspect this",
      operationId: "files-create",
      orchestrator: MODEL,
      projectId: ctx.projectId,
      worker: MODEL,
      workspace: { baseBranch: "main", mode: "new_worktree" as const },
    };
    const snapshot = await ctx.daemon.missions.create(request);
    const goal = snapshot.queue.find(
      (item) => item.id === `${snapshot.mission.id}:goal`
    );
    expect(goal?.attachments).toStrictEqual([ref]);
    await expect(
      store.read(ref.id, snapshot.mission.id)
    ).resolves.toMatchObject({ ref });
    await expect(ctx.daemon.missions.create(request)).resolves.toMatchObject({
      mission: { id: snapshot.mission.id },
    });
    await expect(
      ctx.daemon.missions.create({ ...request, attachmentIds: [] })
    ).rejects.toThrow(/operation/u);
  });

  it("returns a durable receipt when bytes are later missing and never attempts native submission", async () => {
    const ctx = await startMission(await bootDaemon(opened));
    const store = new AttachmentStore(ctx.config.attachmentsDir);
    const ref = await store.upload("missing.txt", Buffer.from("bytes"));
    await store.claim([ref.id], ctx.missionId);
    const read = vi
      .spyOn(AttachmentStore.prototype, "read")
      .mockRejectedValueOnce(new Error("Attachment missing"));
    const request = {
      attachmentIds: [ref.id],
      mode: "queue" as const,
      operationId: "files-missing",
      text: "Missing",
    };
    const receipt = await ctx.daemon.missions.submitMessage(
      ctx.missionId,
      request
    );
    await rm(path.join(ctx.config.attachmentsDir, ctx.missionId, ref.id));
    await waitFor(
      () => ctx.daemon.store.queue.get(receipt.id)?.state === "failed",
      Boolean
    );
    await expect(
      ctx.daemon.missions.submitMessage(ctx.missionId, request)
    ).resolves.toMatchObject({ id: receipt.id, state: "failed" });
    expect(ctx.orchestrator.submitted.map((entry) => entry.id)).not.toContain(
      receipt.id
    );
    read.mockRestore();
  });

  it("preserves legacy queue documents and cleans claimed files when deleting", async () => {
    const ctx = await startMission(await bootDaemon(opened));
    const goal = ctx.daemon.store.queue.get(`${ctx.missionId}:goal`);
    if (!goal) {
      throw new Error("Missing goal");
    }
    const { attachments: _attachments, ...legacy } = goal;
    expect(QueueItemSchema.parse(legacy).attachments).toStrictEqual([]);
    const store = new AttachmentStore(ctx.config.attachmentsDir);
    const ref = await store.upload("cleanup", Buffer.from("content"));
    await ctx.daemon.missions.submitMessage(ctx.missionId, {
      attachmentIds: [ref.id],
      mode: "queue",
      operationId: randomUUID(),
      text: "Cleanup",
    });
    await ctx.daemon.missions.pause(
      ctx.missionId,
      control(ctx.daemon, ctx.missionId, "files-pause")
    );
    await ctx.daemon.missions.remove(
      ctx.missionId,
      control(ctx.daemon, ctx.missionId, "files-delete")
    );
    await expect(store.read(ref.id, ctx.missionId)).rejects.toThrow(
      /Attachment/u
    );
  });

  it("reloads claimed attachments from disk for accepted messages after restart", async () => {
    const ctx = await startMission(await bootDaemon(opened));
    const store = new AttachmentStore(ctx.config.attachmentsDir);
    const ref = await store.upload(
      "resume.txt",
      Buffer.from("resume evidence")
    );
    await store.claim([ref.id], ctx.missionId);
    await ctx.daemon.missions.pause(
      ctx.missionId,
      control(ctx.daemon, ctx.missionId, "restart-pause")
    );
    const template = ctx.daemon.store.queue.get(`${ctx.missionId}:goal`);
    if (!template) {
      throw new Error("Missing template");
    }
    ctx.daemon.store.queue.put({
      ...template,
      attachments: [ref],
      id: "files-accepted",
      sequence: 2,
      state: "accepted",
      text: "Read after restart",
    });
    await ctx.daemon.close();
    const restarted = await bootDaemon(opened, ctx.config);
    await restarted.daemon.missions.resume(
      ctx.missionId,
      control(restarted.daemon, ctx.missionId, "restart-resume")
    );
    const delivered = await waitFor(
      () =>
        restarted.runtimes
          .flatMap((runtime) => runtime.submitted)
          .find((entry) => entry.id === "files-accepted"),
      Boolean
    );
    expect(delivered?.options.files).toStrictEqual([
      {
        data: "resume evidence",
        mediaType: "text/plain",
        name: "resume.txt",
        type: "text",
      },
    ]);
    expect(
      restarted.runtimes
        .flatMap((runtime) => runtime.submitted)
        .filter((entry) => entry.id === "files-accepted")
    ).toHaveLength(1);
  });
});
