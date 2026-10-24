import { z } from "zod";

export const MAX_ATTACHMENTS = 10;
export const IMAGE_LIMIT = 5 * 1024 * 1024;
export const PDF_LIMIT = 20 * 1024 * 1024;
export const TEXT_LIMIT = 512 * 1024;
export const ATTACHMENT_NAME_HEADER = "x-attachment-name";
export const AttachmentIdsSchema = z
  .array(z.uuid())
  .max(MAX_ATTACHMENTS)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    "Attachments must be unique"
  );

export const AttachmentRefSchema = z.object({
  createdAt: z.iso.datetime(),
  id: z.uuid(),
  kind: z.enum(["image", "pdf", "text"]),
  mediaType: z.enum([
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "application/pdf",
    "text/plain",
  ]),
  name: z.string().min(1).max(200),
  size: z.int().nonnegative(),
});
export type AttachmentRef = z.infer<typeof AttachmentRefSchema>;
