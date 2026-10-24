import {
  ATTACHMENT_NAME_HEADER,
  AttachmentRefSchema,
  PDF_LIMIT,
} from "@missions/protocol/attachments";
import { routes } from "@missions/protocol/routes";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import type { AttachmentStore } from "../files/attachment-store";
import { badRequest } from "../lib/app-error";
import type { MissionService } from "../missions/mission-service";
import { param, reply } from "./json";

const content = async (
  c: Context,
  store: AttachmentStore,
  missionId?: string
) => {
  const { data, ref } = await store.read(param(c, "attachmentId"), missionId);
  const inline = ref.kind === "image";
  return c.body(new Uint8Array(data), 200, {
    "cache-control": "no-store",
    "content-disposition": `${inline ? "inline" : "attachment"}; filename="attachment"; filename*=UTF-8''${encodeURIComponent(ref.name)}`,
    "content-security-policy": "default-src 'none'; sandbox",
    "content-type": ref.mediaType,
    "x-content-type-options": "nosniff",
  });
};

export const registerAttachmentRoutes = (
  app: Hono,
  store: AttachmentStore,
  missions: MissionService
) => {
  app.post(
    routes.attachments(),
    bodyLimit({
      maxSize: PDF_LIMIT,
      onError: () => {
        throw badRequest("Attachments must be at most 20 MB");
      },
    }),
    async (c) => {
      let name: string;
      try {
        name = decodeURIComponent(
          c.req.header(ATTACHMENT_NAME_HEADER) ?? "attachment"
        );
      } catch {
        throw badRequest("Invalid attachment name");
      }
      return reply(
        c,
        AttachmentRefSchema,
        await store.upload(name, Buffer.from(await c.req.arrayBuffer())),
        201
      );
    }
  );
  app.get(routes.attachment(":attachmentId"), (c) => content(c, store));
  app.get(routes.missionAttachment(":missionId", ":attachmentId"), (c) => {
    const missionId = param(c, "missionId");
    missions.get(missionId);
    return content(c, store, missionId);
  });
};
