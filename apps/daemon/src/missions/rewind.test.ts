import type { TranscriptItem } from "@missions/protocol/missions";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Daemon } from "../daemon";
import { AttachmentStore } from "../files/attachment-store";
import { FakeRuntime } from "../test/fake-runtime";
import {
  bootDaemon,
  control,
  startMission,
  waitFor,
} from "../test/mission-harness";

const opened: Daemon[] = [];
type Started = Awaited<ReturnType<typeof startMission>>;

const start = async () => {
  const ctx = await startMission(await bootDaemon(opened));
  ctx.orchestrator.consume(`${ctx.missionId}:goal`);
  return ctx;
};

const target = (ctx: Started, requestId = `${ctx.missionId}:goal`) => {
  const item = ctx.daemon.store
    .listTranscript(ctx.missionId)
    .find((row) => row.kind === "user" && row.requestId === requestId);
  if (!item) {
    throw new Error("Missing user transcript");
  }
  return item;
};

const rewind = (
  ctx: Started,
  item: TranscriptItem,
  text = "Edited goal",
  operationId = "rewind-test-operation"
) =>
  ctx.daemon.missions.rewindTranscript(ctx.missionId, item.id, {
    ...control(ctx.daemon, ctx.missionId, operationId),
    text,
  });

const resume = (ctx: Started, operationId: string) =>
  ctx.daemon.missions.resume(
    ctx.missionId,
    control(ctx.daemon, ctx.missionId, operationId)
  );

const pause = (ctx: Started) =>
  ctx.daemon.missions.pause(
    ctx.missionId,
    control(ctx.daemon, ctx.missionId, "rewind-test-pause")
  );

/** Recreates the unsubmitted durable record left by the earlier implementation. */
const leavePending = (ctx: Started, operationId: string) => {
  const saved = ctx.daemon.store.getOperation(operationId);
  if (!saved) {
    throw new Error("Missing rewind operation");
  }
  ctx.daemon.store.putOperation(
    {
      ...saved.operation,
      detail: {
        ...saved.operation.detail,
        submitted: false,
        superseded: false,
      },
    },
    saved.result
  );
};

describe("transcript rewind recovery", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(opened.splice(0).map((daemon) => daemon.close()));
  });

  it.each(["start", "submit"] as const)(
    "allows Resume after a failed %s and sends the edit only once",
    async (failure) => {
      const ctx = await start();
      const item = target(ctx);
      vi.spyOn(FakeRuntime.prototype, failure).mockRejectedValueOnce(
        new Error("session unavailable")
      );
      const mission = await rewind(ctx, item);
      expect(mission.status).toBe("interrupted");
      expect(
        ctx.daemon.store.getOperation("rewind-test-operation")?.operation.detail
          .submitted
      ).toBeFalsy();
      await resume(ctx, "rewind-resume-first");
      expect(
        ctx.runtimes.flatMap((runtime) =>
          runtime.submitted.filter((entry) => entry.text === "Edited goal")
        )
      ).toHaveLength(1);
      expect(
        ctx.daemon.store.getOperation("rewind-test-operation")?.operation.detail
          .submitted
      ).toBeTruthy();
      await pause(ctx);
      await resume(ctx, "rewind-resume-second");
      expect(
        ctx.runtimes.flatMap((runtime) =>
          runtime.submitted.filter((entry) => entry.text === "Edited goal")
        )
      ).toHaveLength(1);
    }
  );

  it.each([false, true])(
    "includes saved files when sending an edit, recovered=%s",
    async (recovered) => {
      const ctx = await start();
      const attachments = new AttachmentStore(ctx.config.attachmentsDir);
      const ref = await attachments.upload(
        "notes.txt",
        Buffer.from("Saved evidence")
      );
      const receipt = await ctx.daemon.missions.submitMessage(ctx.missionId, {
        attachmentIds: [ref.id],
        mode: "steer",
        operationId: "rewind-file-message",
        text: "Read the notes",
      });
      await waitFor(
        () => ctx.orchestrator.submitted.some((row) => row.id === receipt.id),
        Boolean
      );
      ctx.orchestrator.consume(receipt.id);
      if (recovered) {
        vi.spyOn(FakeRuntime.prototype, "submit").mockRejectedValueOnce(
          new Error("submit failed")
        );
      }
      await rewind(ctx, target(ctx, receipt.id), "Read the notes again");
      if (recovered) {
        await resume(ctx, "rewind-files-resume");
      }
      const submissions = ctx.runtimes.flatMap((runtime) =>
        runtime.submitted.filter(
          (entry) => entry.text === "Read the notes again"
        )
      );
      expect(submissions).toHaveLength(1);
      expect(submissions[0]?.options.files).toStrictEqual([
        {
          data: "Saved evidence",
          mediaType: "text/plain",
          name: "notes.txt",
          type: "text",
        },
      ]);
    }
  );

  it.each(["same", "earlier"] as const)(
    "retires a pending edit before rewinding the %s message",
    async (which) => {
      const ctx = await start();
      const goal = target(ctx);
      const later = ctx.daemon.store.appendTranscript({
        ...goal,
        id: "later-user-row",
        requestId: "later-user-request",
        text: "Follow-up",
      });
      await rewind(ctx, later, "Obsolete edit", "rewind-obsolete");
      leavePending(ctx, "rewind-obsolete");
      await rewind(
        ctx,
        which === "same" ? later : goal,
        "Current edit",
        "rewind-current"
      );
      expect(
        ctx.daemon.store.getOperation("rewind-obsolete")?.operation.detail
          .superseded
      ).toBeTruthy();
      await pause(ctx);
      await resume(ctx, "rewind-current-resume");
      expect(
        ctx.runtimes.flatMap((runtime) =>
          runtime.submitted
            .filter((entry) =>
              ["Obsolete edit", "Current edit"].includes(entry.text)
            )
            .map((entry) => entry.text)
        )
      ).toStrictEqual(["Obsolete edit", "Current edit"]);
    }
  );

  it.each([false, true])(
    "ignores superseded legacy edits without hiding the current recovery, pending=%s",
    async (pending) => {
      const ctx = await start();
      const goal = target(ctx);
      const later = ctx.daemon.store.appendTranscript({
        ...goal,
        id: "legacy-later-row",
        requestId: "legacy-later-request",
        text: "Follow-up",
      });
      await rewind(ctx, later, "Obsolete edit", "rewind-legacy");
      if (pending) {
        vi.spyOn(FakeRuntime.prototype, "submit").mockRejectedValueOnce(
          new Error("submit failed")
        );
      }
      await rewind(ctx, goal, "Current edit", "rewind-current");
      leavePending(ctx, "rewind-legacy");
      if (!pending) {
        await pause(ctx);
      }
      await resume(ctx, "rewind-legacy-resume");
      expect(
        ctx.runtimes.flatMap((runtime) =>
          runtime.submitted
            .filter((entry) =>
              ["Obsolete edit", "Current edit"].includes(entry.text)
            )
            .map((entry) => entry.text)
        )
      ).toStrictEqual(["Obsolete edit", "Current edit"]);
    }
  );

  it("replays a succeeded operation without changing text or submitting again", async () => {
    const ctx = await start();
    const item = target(ctx);
    await rewind(ctx, item);
    const before = ctx.daemon.missions.snapshot(ctx.missionId);
    const submissions = ctx.runtimes.flatMap((runtime) => runtime.submitted);
    await ctx.daemon.missions.rewindTranscript(ctx.missionId, "other-item", {
      expectedRevision: 0,
      operationId: "rewind-test-operation",
      text: "Ignored replay text",
    });
    expect(ctx.daemon.missions.snapshot(ctx.missionId)).toStrictEqual(before);
    expect(ctx.runtimes.flatMap((runtime) => runtime.submitted)).toStrictEqual(
      submissions
    );
  });

  it("returns a conflict and leaves the transcript unchanged when close rejects", async () => {
    const ctx = await start();
    const item = target(ctx);
    const before = ctx.daemon.store.listTranscript(ctx.missionId);
    vi.spyOn(ctx.orchestrator, "close").mockRejectedValueOnce(
      new Error("stop failed")
    );
    await expect(rewind(ctx, item)).rejects.toMatchObject({
      code: "conflict",
      message: "Could not restart. The chat is unchanged.",
    });
    expect(ctx.daemon.store.listTranscript(ctx.missionId)).toStrictEqual(
      before
    );
    opened.splice(opened.indexOf(ctx.daemon), 1);
    await expect(ctx.daemon.close()).rejects.toThrow(/shutdown failed/u);
  });

  it("keeps the edited row in snapshots and agent history after a long discarded tail", async () => {
    const ctx = await start();
    const item = target(ctx);
    for (let index = 0; index < 225; index += 1) {
      ctx.daemon.store.appendTranscript({
        ...item,
        id: `discarded-row-${index}`,
        kind: "assistant",
        requestId: null,
        text: "Discarded reply",
      });
    }
    await rewind(ctx, item);
    const snapshot = ctx.daemon.missions.snapshot(ctx.missionId);
    expect(snapshot.transcript[0]).toMatchObject({
      id: item.id,
      text: "Edited goal",
    });
    expect(snapshot.transcriptHasMore).toBeFalsy();
    const runtime = ctx.runtimes.at(-1);
    const history = await runtime?.tool("read_history", { limit: 1 });
    expect(JSON.stringify(history)).toContain("Edited goal");
    expect(JSON.stringify(history)).not.toContain("Discarded reply");
    expect(
      ctx.daemon.missions.transcript(ctx.missionId, null, 1).nextCursor
    ).toBeNull();
  });

  it("does not load the whole transcript to deduplicate a user echo", async () => {
    const ctx = await start();
    const list = vi.spyOn(ctx.daemon.store, "listTranscript");
    ctx.orchestrator.consume(`${ctx.missionId}:goal`);
    expect(list).not.toHaveBeenCalled();
    expect(
      ctx.daemon.missions
        .snapshot(ctx.missionId)
        .transcript.filter((item) => item.kind === "user")
    ).toHaveLength(1);
  });

  it("discards every later card and cancels pending decisions without discarding older cards", async () => {
    const ctx = await start();
    const item = target(ctx);
    const createdAt = new Date(Date.parse(item.createdAt) + 1000).toISOString();
    const common = {
      agentId: item.agentId,
      createdAt,
      epoch: 0,
      missionId: ctx.missionId,
    };
    ctx.daemon.store.assignments.put({
      ...common,
      handoff: null,
      id: "rewind-assignment",
      instructions: "Work",
      needsWrite: false,
      status: "queued",
      title: "Later work",
      updatedAt: createdAt,
      workerAgentId: null,
    });
    const question = ctx.daemon.store.questions.put({
      ...common,
      answers: null,
      id: "rewind-question",
      questions: [],
      status: "pending",
    });
    ctx.daemon.store.questions.put({
      ...question,
      answers: [],
      createdAt: item.createdAt,
      id: "older-question",
      status: "answered",
    });
    const plan = ctx.daemon.store.plans.put({
      ...common,
      actionable: true,
      decidedAt: null,
      feedback: null,
      guidanceVersion: null,
      id: "rewind-plan",
      markdown: "# Later plan",
      revision: 1,
      sessionId: ctx.orchestrator.sessionId,
      status: "proposed",
      title: "Later plan",
      toolUseId: null,
    });
    ctx.daemon.store.plans.put({
      ...plan,
      actionable: false,
      createdAt: item.createdAt,
      id: "older-plan",
      revision: 2,
      status: "approved",
    });
    ctx.daemon.store.permissions.put({
      ...common,
      allowAlways: false,
      decidedAt: null,
      decision: null,
      id: "rewind-permission",
      kind: "tool",
      reason: null,
      status: "pending",
      toolUses: [],
    });
    await rewind(ctx, item);
    expect({
      assignment: ctx.daemon.store.assignments.get("rewind-assignment"),
      permission: ctx.daemon.store.permissions.get("rewind-permission"),
      plan: ctx.daemon.store.plans.get("rewind-plan"),
      question: ctx.daemon.store.questions.get("rewind-question"),
    }).toMatchObject({
      assignment: { rewindDiscarded: true, status: "cancelled" },
      permission: { rewindDiscarded: true, status: "cancelled" },
      plan: { actionable: false, rewindDiscarded: true },
      question: { rewindDiscarded: true, status: "cancelled" },
    });
    expect({
      plan: ctx.daemon.store.plans.get("older-plan"),
      question: ctx.daemon.store.questions.get("older-question"),
    }).toMatchObject({
      plan: { rewindDiscarded: false, status: "approved" },
      question: { rewindDiscarded: false, status: "answered" },
    });
    await pause(ctx);
    await resume(ctx, "rewind-cards-resume");
    expect(ctx.daemon.store.assignments.get("rewind-assignment")?.status).toBe(
      "cancelled"
    );
  });
});
