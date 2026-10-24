import {
  IMAGE_LIMIT,
  PDF_LIMIT,
  TEXT_LIMIT,
} from "@missions/protocol/attachments";
import type { AttachmentRef } from "@missions/protocol/attachments";

import { badRequest } from "../lib/app-error";

const imageType = (data: Buffer): AttachmentRef["mediaType"] | null => {
  if (
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return "image/png";
  }
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) {
    return "image/jpeg";
  }
  const head = data.toString("ascii", 0, 6);
  if (head === "GIF87a" || head === "GIF89a") {
    return "image/gif";
  }
  if (
    data.toString("ascii", 0, 4) === "RIFF" &&
    data.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
};

export const sniffAttachment = (
  data: Buffer
): Pick<AttachmentRef, "kind" | "mediaType"> => {
  const image = imageType(data);
  if (image) {
    if (data.length > IMAGE_LIMIT) {
      throw badRequest("Images must be at most 5 MB");
    }
    return { kind: "image", mediaType: image };
  }
  if (data.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    if (data.length > PDF_LIMIT) {
      throw badRequest("PDFs must be at most 20 MB");
    }
    return { kind: "pdf", mediaType: "application/pdf" };
  }
  if (data.length > TEXT_LIMIT) {
    throw badRequest("Text files must be at most 512 KB");
  }
  if (data.includes(0)) {
    throw badRequest("Only images, PDF and UTF-8 text files are supported");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    throw badRequest("Text files must contain valid UTF-8");
  }
  if (
    /^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/iu.test(
      text.trimStart()
    )
  ) {
    throw badRequest("SVG images are not supported");
  }
  return { kind: "text", mediaType: "text/plain" };
};
