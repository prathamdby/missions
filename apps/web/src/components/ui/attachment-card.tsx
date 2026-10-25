"use client";

import Image from "next/image";

import { CloseIcon, FileTextIcon, PdfIcon } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/spinner";
import { Hint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export const AttachmentCard = ({
  image,
  name,
  onRemove,
  size,
  status = "ready",
  url,
}: {
  image: boolean;
  name: string;
  onRemove?: () => void;
  size: number;
  status?: "failed" | "ready" | "uploading";
  url: string | null;
}) => {
  let details = `${Math.max(1, Math.round(size / 1024))} KB`;
  const FileIcon = name.toLowerCase().endsWith(".pdf") ? PdfIcon : FileTextIcon;
  if (status === "uploading") {
    details = "Uploading…";
  } else if (status === "failed") {
    details = "Upload failed";
  }
  return (
    <div
      className={cn(
        "relative shrink-0",
        image ? "size-12" : "h-12 w-40 max-w-full"
      )}
    >
      <a
        aria-label={name}
        className={cn(
          "flex h-12 min-w-0 items-center gap-md rounded-sm bg-surface-overlay text-text shadow-[0_0_0_1px_var(--color-border)] outline-none focus-visible:shadow-focus",
          image ? "size-12 overflow-hidden" : "w-full pr-lg pl-control"
        )}
        href={url ?? undefined}
        rel="noopener noreferrer"
        target="_blank"
        title={name}
      >
        {image && url ? (
          <Image
            alt={name}
            className="size-12 object-cover"
            height={48}
            src={url}
            unoptimized
            width={48}
          />
        ) : (
          <>
            {status === "uploading" ? (
              <Spinner label={`Uploading ${name}`} pattern="wave" />
            ) : (
              <FileIcon className="size-4.5" tone="secondary" />
            )}
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-xs leading-sm font-medium tracking-tight">
                {name}
              </span>
              <span className="text-2xs leading-xs font-book tracking-tight text-text-secondary">
                {details}
              </span>
            </span>
          </>
        )}
      </a>
      {image && status === "uploading" ? (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-sm bg-scrim">
          <Spinner label={`Uploading ${name}`} pattern="wave" />
        </span>
      ) : null}
      {onRemove ? (
        <Hint label={`Remove ${name}`}>
          <button
            aria-label={`Remove ${name}`}
            className="absolute -top-tight -right-tight flex size-4 cursor-pointer items-center justify-center rounded-full bg-surface-active text-text-secondary shadow-[0_0_0_1px_var(--color-border-strong)] hover:text-text focus-visible:shadow-focus"
            onClick={onRemove}
            type="button"
          >
            <CloseIcon className="size-2.5" />
          </button>
        </Hint>
      ) : null}
    </div>
  );
};
