import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, utimes } from "node:fs/promises";
import path from "node:path";

import {
  IMAGE_LIMIT,
  PDF_LIMIT,
  TEXT_LIMIT,
} from "@missions/protocol/attachments";
import { describe, expect, it } from "vitest";

import { attachmentPayload } from "../sdk/attachments";
import { tempDir } from "../test/fixtures";
import { AttachmentStore } from "./attachment-store";
import { sniffAttachment } from "./sniff-attachment";

const PNG = Buffer.from("89504e470d0a1a0a", "hex");
const DAY = 24 * 60 * 60_000;

describe("attachment bytes", () => {
  it.each([
    [PNG, "image/png"],
    [Buffer.from([255, 216, 255, 0]), "image/jpeg"],
    [Buffer.from("GIF89a"), "image/gif"],
    [Buffer.from("RIFF1234WEBP"), "image/webp"],
    [Buffer.from("%PDF-1.7\n"), "application/pdf"],
    [Buffer.from("valid UTF-8: λ"), "text/plain"],
  ])(
    "sniffs %s without trusting a filename or supplied content type",
    (bytes, mediaType) => {
      expect(sniffAttachment(bytes).mediaType).toBe(mediaType);
    }
  );

  it("enforces separate limits and rejects binary or invalid UTF-8", () => {
    expect(() =>
      sniffAttachment(Buffer.concat([PNG, Buffer.alloc(IMAGE_LIMIT)]))
    ).toThrow(/5 MB/u);
    expect(() =>
      sniffAttachment(
        Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(PDF_LIMIT)])
      )
    ).toThrow(/20 MB/u);
    expect(() => sniffAttachment(Buffer.alloc(TEXT_LIMIT + 1, 65))).toThrow(
      /512 KB/u
    );
    expect(() => sniffAttachment(Buffer.from([65, 0]))).toThrow(/supported/u);
    expect(() => sniffAttachment(Buffer.from([255, 255]))).toThrow(/UTF-8/u);
  });

  it("keeps truncated Unicode names safe for response headers", async () => {
    const store = new AttachmentStore(await tempDir("attachments"));
    const ref = await store.upload(`${"a".repeat(199)}😀`, Buffer.from("text"));
    expect(ref.name.length).toBeLessThanOrEqual(200);
    expect(() => encodeURIComponent(ref.name)).not.toThrow();
  });

  it("claims files idempotently within one mission", async () => {
    const dir = await tempDir("attachments");
    const store = new AttachmentStore(dir);
    const ref = await store.upload("../notes.txt", Buffer.from("hello"));
    const missionId = randomUUID();
    const [first, replay] = await Promise.all([
      store.claim([ref.id], missionId),
      store.claim([ref.id], missionId),
    ]);
    expect([first, replay]).toStrictEqual([[ref], [ref]]);
    await expect(store.claim([ref.id], randomUUID())).rejects.toThrow(
      /Attachment/u
    );
    await expect(
      readFile(path.join(dir, missionId, ref.id), "utf-8")
    ).resolves.toBe("hello");
    expect(
      JSON.parse(
        await readFile(path.join(dir, missionId, `${ref.id}.json`), "utf-8")
      )
    ).toStrictEqual(ref);
    expect(ref.name).toBe("notes.txt");
  });

  it("validates the whole claim before moving and rejects duplicate IDs", async () => {
    const dir = await tempDir("attachments");
    const store = new AttachmentStore(dir);
    const ref = await store.upload("a", Buffer.from("text"));
    await expect(
      store.claim([ref.id, randomUUID()], randomUUID())
    ).rejects.toThrow(/Attachment/u);
    await expect(store.read(ref.id)).resolves.toMatchObject({ ref });
    await expect(store.claim([ref.id, ref.id], randomUUID())).rejects.toThrow(
      /unique/u
    );
    await expect(
      store.claim(
        Array.from({ length: 11 }, () => randomUUID()),
        randomUUID()
      )
    ).rejects.toThrow(/10/u);
  });

  it("sweeps abandoned uploads but retains claimed mission content", async () => {
    const dir = await tempDir("attachments");
    let now = Date.now();
    const store = new AttachmentStore(dir, () => new Date(now));
    const abandoned = await store.upload("old", Buffer.from("old"));
    const claimed = await store.upload("kept", Buffer.from("kept"));
    const missionId = randomUUID();
    await store.claim([claimed.id], missionId);
    const old = new Date(now - DAY - 1);
    await utimes(path.join(dir, "pending", `${abandoned.id}.json`), old, old);
    now += DAY + 1;
    await store.sweepPending();
    await expect(store.read(abandoned.id)).rejects.toThrow(/Attachment/u);
    await expect(store.read(claimed.id, missionId)).resolves.toMatchObject({
      ref: claimed,
    });
    await store.remove(missionId);
    await expect(stat(path.join(dir, missionId))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(store.claim([], missionId)).rejects.toThrow(/deleted/u);
  });

  it("maps images and PDF to base64 and text to native file text", async () => {
    const store = new AttachmentStore(await tempDir("attachments"));
    const refs = await Promise.all([
      store.upload("picture.png", PNG),
      store.upload("doc.pdf", Buffer.from("%PDF-1.7")),
      store.upload("notes.txt", Buffer.from("λ notes")),
    ]);
    const missionId = randomUUID();
    const attachments = await store.claim(
      refs.map((ref) => ref.id),
      missionId
    );
    await expect(
      attachmentPayload(store, { attachments, missionId })
    ).resolves.toStrictEqual({
      files: [
        {
          data: Buffer.from("%PDF-1.7").toString("base64"),
          mediaType: "application/pdf",
          name: "doc.pdf",
          type: "base64",
        },
        {
          data: "λ notes",
          mediaType: "text/plain",
          name: "notes.txt",
          type: "text",
        },
      ],
      images: [
        {
          data: PNG.toString("base64"),
          mediaType: "image/png",
          type: "base64",
        },
      ],
    });
  });

  it("finishes an interrupted claim when only the bytes reached the mission folder", async () => {
    const dir = await tempDir("attachments");
    const store = new AttachmentStore(dir);
    const ref = await store.upload("resume.txt", Buffer.from("content"));
    const missionId = randomUUID();
    await mkdir(path.join(dir, missionId));
    await rename(
      path.join(dir, "pending", ref.id),
      path.join(dir, missionId, ref.id)
    );
    await expect(store.claim([ref.id], missionId)).resolves.toStrictEqual([
      ref,
    ]);
    await expect(store.read(ref.id, missionId)).resolves.toMatchObject({ ref });
  });

  it("rejects fake PNGs and SVG uploads", async () => {
    const store = new AttachmentStore(await tempDir("attachments"));
    await expect(
      store.upload("fake.png", Buffer.from("not a PNG"))
    ).rejects.toThrow(/image data/u);
    await expect(
      store.upload("image.svg", Buffer.from("<svg />"))
    ).rejects.toThrow(/SVG/u);
    await expect(
      store.upload("notes.txt", Buffer.from("<?xml version='1.0'?><svg></svg>"))
    ).rejects.toThrow(/SVG/u);
  });
});
