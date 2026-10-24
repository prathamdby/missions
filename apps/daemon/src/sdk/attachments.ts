import type { DroidClient } from "@factory/droid-sdk/node";
import type { QueueItem } from "@missions/protocol/missions";

import type { AttachmentStore } from "../files/attachment-store";

export type SdkAttachments = Pick<
  Parameters<DroidClient["addUserMessage"]>[0],
  "images" | "files"
>;

export const attachmentPayload = async (
  store: AttachmentStore,
  item: Pick<QueueItem, "missionId" | "attachments">
): Promise<SdkAttachments> => {
  const images: NonNullable<SdkAttachments["images"]> = [];
  const files: NonNullable<SdkAttachments["files"]> = [];
  const entries = await Promise.all(
    item.attachments.map((ref) => store.read(ref.id, item.missionId))
  );
  for (const { data, ref } of entries) {
    if (ref.mediaType === "application/pdf") {
      files.push({
        data: data.toString("base64"),
        mediaType: "application/pdf",
        name: ref.name,
        type: "base64" as never,
      });
    } else if (ref.mediaType === "text/plain") {
      files.push({
        data: data.toString("utf-8"),
        mediaType: "text/plain",
        name: ref.name,
        type: "text" as never,
      });
    } else {
      images.push({
        data: data.toString("base64"),
        mediaType: ref.mediaType,
        type: "base64",
      });
    }
  }
  return {
    ...(images.length ? { images } : {}),
    ...(files.length ? { files } : {}),
  };
};
