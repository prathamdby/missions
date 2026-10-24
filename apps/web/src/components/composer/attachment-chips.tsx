"use client";

import type { AttachmentRef } from "@missions/protocol/attachments";
import { routes } from "@missions/protocol/routes";
import Image from "next/image";
import { useMemo, useSyncExternalStore } from "react";

import { IconButton } from "@/components/ui/button";
import { CloseIcon } from "@/components/ui/icons";
import { proxyUrl } from "@/lib/api/client";
import { FilePreviewSource } from "@/lib/composer/file-preview";
import type {
  DraftAttachment,
  MessageDraft,
} from "@/lib/mission/message-draft";

const FilePreview = ({
  attachment,
  url,
}: {
  attachment: AttachmentRef;
  url: string;
}) => (
  <a
    className="flex min-w-0 items-center gap-sm text-xs text-text-secondary underline-offset-4 hover:underline"
    href={url}
    rel="noopener noreferrer"
    target="_blank"
  >
    {attachment.kind === "image" ? (
      <Image
        alt={attachment.name}
        className="size-12 rounded-sm object-cover"
        height={48}
        src={url}
        unoptimized
        width={48}
      />
    ) : null}
    <span className="truncate">{attachment.name}</span>
  </a>
);

export const AttachmentPreview = ({
  attachment,
  missionId,
}: {
  attachment: AttachmentRef;
  missionId: string;
}) => (
  <FilePreview
    attachment={attachment}
    url={proxyUrl(routes.missionAttachment(missionId, attachment.id))}
  />
);

/** Draft previews stay local even when a lost receipt moved the upload. */
const DraftPreview = ({ file }: { file: DraftAttachment }) => {
  const preview = useMemo(
    () => new FilePreviewSource(file.source),
    [file.source]
  );
  const url = useSyncExternalStore(
    preview.subscribe,
    preview.snapshot,
    () => null
  );
  return file.ref && url ? (
    <FilePreview attachment={file.ref} url={url} />
  ) : (
    <span className="text-xs text-text-secondary">{file.name}</span>
  );
};

export const AttachmentChips = ({
  files,
  draft,
}: {
  files: readonly DraftAttachment[];
  draft: MessageDraft;
}) =>
  files.length ? (
    <ul aria-label="Attachments" className="flex flex-wrap gap-sm">
      {files.map((file) => (
        <li
          className="flex min-w-0 items-center gap-xs rounded-sm bg-surface-overlay px-sm py-xs"
          key={file.key}
        >
          {file.ref ? (
            <DraftPreview file={file} />
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
