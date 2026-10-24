"use client";

import type { AttachmentRef } from "@missions/protocol/attachments";
import { routes } from "@missions/protocol/routes";
import Image from "next/image";

import { IconButton } from "@/components/ui/button";
import { CloseIcon } from "@/components/ui/icons";
import { proxyUrl } from "@/lib/api/client";
import type {
  DraftAttachment,
  MessageDraft,
} from "@/lib/mission/message-draft";

const contentUrl = (ref: AttachmentRef, missionId?: string) =>
  proxyUrl(
    missionId
      ? routes.missionAttachment(missionId, ref.id)
      : routes.attachment(ref.id)
  );

export const AttachmentPreview = ({
  attachment,
  missionId,
}: {
  attachment: AttachmentRef;
  missionId?: string;
}) => (
  <a
    className="flex min-w-0 items-center gap-sm text-xs text-text-secondary underline-offset-4 hover:underline"
    href={contentUrl(attachment, missionId)}
    rel="noopener noreferrer"
    target="_blank"
  >
    {attachment.kind === "image" ? (
      <Image
        alt={attachment.name}
        className="size-12 rounded-sm object-cover"
        height={48}
        src={contentUrl(attachment, missionId)}
        unoptimized
        width={48}
      />
    ) : null}
    <span className="truncate">{attachment.name}</span>
  </a>
);

export const AttachmentChips = ({
  files,
  draft,
  missionId,
}: {
  files: readonly DraftAttachment[];
  draft: MessageDraft;
  missionId?: string;
}) =>
  files.length ? (
    <ul aria-label="Attachments" className="flex flex-wrap gap-sm">
      {files.map((file) => (
        <li
          className="flex min-w-0 items-center gap-xs rounded-sm bg-surface-overlay px-sm py-xs"
          key={file.key}
        >
          {file.ref ? (
            <AttachmentPreview attachment={file.ref} missionId={missionId} />
          ) : (
            <span className="text-xs text-text-secondary">
              {file.name} ·{" "}
              {file.status === "uploading" ? "Uploading…" : file.error}
            </span>
          )}
          <IconButton
            icon={<CloseIcon />}
            label={`Remove ${file.name}`}
            onClick={() => draft.removeAttachment(file.key)}
            size="sm"
          />
        </li>
      ))}
    </ul>
  ) : null;
