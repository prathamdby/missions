"use client";

import type { AttachmentRef } from "@missions/protocol/attachments";
import { routes } from "@missions/protocol/routes";
import { useMemo, useSyncExternalStore } from "react";

import { AttachmentCard } from "@/components/ui/attachment-card";
import { Button } from "@/components/ui/button";
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
  <AttachmentCard
    image={attachment.kind === "image"}
    name={attachment.name}
    size={attachment.size}
    url={url}
  />
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
export const DraftPreview = ({
  file,
  onRemove,
}: {
  file: DraftAttachment;
  onRemove?: () => void;
}) => {
  const preview = useMemo(
    () => new FilePreviewSource(file.source),
    [file.source]
  );
  const url = useSyncExternalStore(
    preview.subscribe,
    preview.snapshot,
    () => null
  );
  return (
    <AttachmentCard
      image={file.source.type.startsWith("image/")}
      name={file.name}
      onRemove={onRemove}
      size={file.source.size}
      status={file.status}
      url={url}
    />
  );
};

export const AttachmentChips = ({
  files,
  draft,
  onRetry,
}: {
  files: readonly DraftAttachment[];
  draft: MessageDraft;
  onRetry: (file: DraftAttachment) => void;
}) =>
  files.length ? (
    <ul
      aria-label="Attachments"
      className="flex flex-wrap gap-control pt-xs pr-xs"
    >
      {files.map((file) => (
        <li className="flex max-w-full min-w-0 flex-col gap-sm" key={file.key}>
          <DraftPreview
            file={file}
            onRemove={() => draft.removeAttachment(file.key)}
          />
          {file.status === "failed" ? (
            <div className="flex max-w-full flex-wrap items-center gap-sm">
              <p
                className="max-w-60 text-xs leading-sm break-words text-danger"
                role="alert"
              >
                {file.name}: {file.error}
              </p>
              <Button onClick={() => onRetry(file)} size="sm" variant="ghost">
                Retry
              </Button>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  ) : null;
