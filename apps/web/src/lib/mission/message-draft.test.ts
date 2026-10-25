import { MAX_ATTACHMENTS } from "@missions/protocol/attachments";
import { describe, expect, it } from "vitest";

import { MessageDraft } from "./message-draft";

const file = (name: string) =>
  new File(["notes"], name, { type: "text/plain" });

const draft = () => {
  let next = 0;
  return new MessageDraft(() => {
    next += 1;
    return `message-${next}`;
  });
};

describe(MessageDraft, () => {
  it("admits distinct identical messages but ignores an immediate duplicate submit", () => {
    const controller = draft();
    controller.change("  Hello  ");
    const first = controller.take("steer");
    expect(controller.take("steer")).toBeNull();
    controller.change("Hello");
    const second = controller.take("steer");
    expect(first?.input).toStrictEqual(second?.input);
    expect(first?.occurrence).not.toBe(second?.occurrence);
  });

  it("restores the same logical occurrence on retry without erasing a newer draft", () => {
    const controller = draft();
    controller.change("first");
    const first = controller.take("queue");
    if (!first) {
      throw new Error("Missing test delivery");
    }
    controller.change("new draft");
    controller.restore(first);
    expect(controller.snapshot()).toBe("new draft");
    expect(controller.take("steer")?.input.text).toBe("new draft");
    expect(controller.snapshot()).toBe("first");
    expect(controller.take("queue")).toStrictEqual(first);
  });

  it("keeps every failed concurrent delivery and gives changed payloads a new occurrence", () => {
    const controller = draft();
    controller.change("one");
    const one = controller.take("steer");
    controller.change("two");
    const two = controller.take("steer");
    if (!one || !two) {
      throw new Error("Missing test deliveries");
    }
    controller.restore(two);
    controller.restore(one);
    controller.change("edited two");
    expect(controller.take("steer")?.occurrence).not.toBe(two.occurrence);
    expect(controller.take("steer")).toStrictEqual(one);
  });

  it("treats changed delivery placement as a new occurrence", () => {
    const controller = draft();
    controller.change("plan this");
    const plan = controller.take("queue");
    if (!plan) {
      throw new Error("Missing test delivery");
    }
    expect(plan.input).toStrictEqual({
      mode: "queue",
      text: "plan this",
    });
    controller.restore(plan);
    expect(controller.take("steer")?.occurrence).not.toBe(plan.occurrence);
  });
});

describe("attachment draft ownership", () => {
  const attachment = {
    createdAt: "2026-01-01T00:00:00.000Z",
    id: "f40a50d7-0aeb-4bb8-941b-200778425b58",
    kind: "text" as const,
    mediaType: "text/plain" as const,
    name: "notes.txt",
    size: 5,
  };

  it("blocks unfinished uploads and snapshots ready attachments on send", () => {
    const controller = draft();
    controller.change("Read this");
    controller.beginAttachment("upload", file("notes.txt"));
    expect(controller.take("steer")).toBeNull();
    controller.finishAttachment("upload", attachment);
    const delivery = controller.take("steer");
    expect(delivery?.input).toStrictEqual({
      attachmentIds: [attachment.id],
      mode: "steer",
      text: "Read this",
    });
    expect(controller.attachmentSnapshot()).toStrictEqual([]);
    expect(delivery?.attachments?.[0]?.ref).toStrictEqual(attachment);
  });

  it("restores files with the same occurrence without erasing a newer attached draft", () => {
    const controller = draft();
    controller.beginAttachment("first", file("notes.txt"));
    controller.finishAttachment("first", attachment);
    const first = controller.take("queue");
    if (!first) {
      throw new Error("Missing delivery");
    }
    controller.change("new");
    controller.beginAttachment("second", file("other.txt"));
    controller.finishAttachment("second", {
      ...attachment,
      id: "97868586-f932-46dd-91bc-1f44f532d238",
    });
    controller.restore(first);
    expect(controller.snapshot()).toBe("new");
    controller.take("steer");
    expect(controller.attachmentIds()).toStrictEqual([attachment.id]);
    expect(controller.take("queue")).toStrictEqual(first);
  });

  it("ignores late upload completion after removal and blocks failed files", () => {
    const controller = draft();
    controller.beginAttachment("gone", file("notes.txt"));
    controller.removeAttachment("gone");
    controller.finishAttachment("gone", attachment);
    expect(controller.attachmentSnapshot()).toStrictEqual([]);
    controller.change("text");
    controller.beginAttachment("failed", file("notes.txt"));
    controller.failAttachment("failed", "offline");
    expect(controller.take("steer")).toBeNull();
    controller.removeAttachment("failed");
    expect(controller.take("steer")?.input.text).toBe("text");
  });

  it("refuses an eleventh file and admits a replacement after removal", () => {
    const controller = draft();
    const admitted = Array.from({ length: MAX_ATTACHMENTS }, (_, index) =>
      controller.beginAttachment(`file-${index}`, file(`${index}.txt`))
    );
    expect(admitted).toStrictEqual(
      Array.from({ length: MAX_ATTACHMENTS }, () => true)
    );
    expect(controller.beginAttachment("extra", file("extra.txt"))).toBeFalsy();
    expect(controller.take("steer")).toBeNull();
    controller.removeAttachment("file-0");
    expect(
      controller.beginAttachment("replacement", file("replacement.txt"))
    ).toBeTruthy();
    expect(controller.take("steer")).toBeNull();
  });

  it("retries the same local file, blocks concurrent retry and preserves the text", () => {
    const controller = draft();
    const source = file("notes.txt");
    controller.change("Keep this draft");
    controller.beginAttachment("retry", source);
    controller.failAttachment("retry", "offline");
    expect([
      controller.retryAttachment("retry"),
      controller.retryAttachment("retry"),
    ]).toStrictEqual([true, false]);
    expect(controller.attachmentSnapshot()[0]).toMatchObject({
      error: null,
      source,
      status: "uploading",
    });
    expect(controller.uploadsReady()).toBeFalsy();
    controller.finishAttachment("retry", attachment);
    expect([controller.uploadsReady(), controller.snapshot()]).toStrictEqual([
      true,
      "Keep this draft",
    ]);
    controller.removeAttachment("retry");
    expect([
      controller.retryAttachment("retry"),
      controller.snapshot(),
    ]).toStrictEqual([false, "Keep this draft"]);
  });
});
