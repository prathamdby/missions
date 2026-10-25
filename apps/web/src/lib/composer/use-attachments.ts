"use client";

import type { ChangeEvent, ClipboardEvent, DragEvent } from "react";
import { useState } from "react";

import { errorMessage } from "@/lib/api/api-error";
import { api } from "@/lib/api/endpoints";
import type {
  DraftAttachment,
  MessageDraft,
} from "@/lib/mission/message-draft";

export const useAttachments = (draft: MessageDraft, disabled: boolean) => {
  const [error, setError] = useState<string | null>(null);
  const upload = async (file: File, key: string) => {
    try {
      draft.finishAttachment(key, await api.uploadAttachment(file));
    } catch (error_) {
      draft.failAttachment(key, errorMessage(error_));
    }
  };
  const add = (files: FileList | File[]) => {
    if (disabled) {
      return;
    }
    setError(null);
    for (const file of files) {
      const key = crypto.randomUUID();
      if (!draft.beginAttachment(key, file)) {
        setError("Attach at most 10 files");
        break;
      }
      void upload(file, key);
    }
  };
  return {
    error,
    handleDrop: (event: DragEvent) => {
      event.preventDefault();
      add(event.dataTransfer.files);
    },
    handlePaste: (event: ClipboardEvent) => {
      if (event.clipboardData.files.length > 0) {
        event.preventDefault();
        add(event.clipboardData.files);
      }
    },
    handleRetry: (file: DraftAttachment) => {
      if (!disabled && draft.retryAttachment(file.key)) {
        void upload(file.source, file.key);
      }
    },
    handleSelect: (event: ChangeEvent<HTMLInputElement>) => {
      if (event.currentTarget.files) {
        add(event.currentTarget.files);
      }
      event.currentTarget.value = "";
    },
  };
};
