import { MAX_ATTACHMENTS } from "@missions/protocol/attachments";
import type { AttachmentRef } from "@missions/protocol/attachments";
import type { DeliveryMode } from "@missions/protocol/common";

export interface DraftAttachment {
  key: string;
  name: string;
  source: File;
  status: "uploading" | "ready" | "failed";
  ref: AttachmentRef | null;
  error: string | null;
}
export interface MessageDelivery {
  input: { mode: DeliveryMode; text: string; attachmentIds?: string[] };
  occurrence: string;
  attachments?: readonly DraftAttachment[];
}

/** Composer draft/failed-delivery ownership, independent of React scheduling. */
export class MessageDraft {
  private text = "";
  private files: readonly DraftAttachment[] = [];
  private retry: MessageDelivery | null = null;
  private readonly waiting: MessageDelivery[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly newId: () => string;

  constructor(newId: () => string = () => crypto.randomUUID()) {
    this.newId = newId;
  }

  snapshot = () => this.text;
  attachmentSnapshot = () => this.files;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  change(text: string): void {
    this.text = text;
    this.emit();
  }

  beginAttachment(key: string, source: File): boolean {
    if (this.files.length >= MAX_ATTACHMENTS) {
      return false;
    }
    this.files = [
      ...this.files,
      {
        error: null,
        key,
        name: source.name,
        ref: null,
        source,
        status: "uploading",
      },
    ];
    this.emit();
    return true;
  }

  finishAttachment(key: string, ref: AttachmentRef): void {
    this.files = this.files.map((file) =>
      file.key === key ? { ...file, error: null, ref, status: "ready" } : file
    );
    this.emit();
  }

  retryAttachment(key: string): boolean {
    const file = this.files.find((candidate) => candidate.key === key);
    if (file?.status !== "failed") {
      return false;
    }
    this.files = this.files.map((candidate) =>
      candidate.key === key
        ? { ...candidate, error: null, status: "uploading" }
        : candidate
    );
    this.emit();
    return true;
  }

  failAttachment(key: string, error: string): void {
    this.files = this.files.map((file) =>
      file.key === key ? { ...file, error, status: "failed" } : file
    );
    this.emit();
  }

  removeAttachment(key: string): void {
    this.files = this.files.filter((file) => file.key !== key);
    this.restoreNext();
    this.emit();
  }

  attachmentIds(): string[] {
    return this.files.flatMap((file) => (file.ref ? [file.ref.id] : []));
  }

  uploadsReady(): boolean {
    return this.files.every((file) => file.status === "ready");
  }

  clear(): void {
    this.text = "";
    this.files = [];
    this.retry = null;
    this.emit();
  }

  take(mode: DeliveryMode): MessageDelivery | null {
    const text = this.text.trim();
    if ((!text && this.files.length === 0) || !this.uploadsReady()) {
      return null;
    }
    const attachmentIds = this.attachmentIds();
    const same =
      this.retry?.input.text === text &&
      this.retry.input.mode === mode &&
      JSON.stringify(this.retry.input.attachmentIds ?? []) ===
        JSON.stringify(attachmentIds);
    const delivery =
      same && this.retry
        ? this.retry
        : {
            ...(this.files.length ? { attachments: this.files } : {}),
            input: {
              ...(attachmentIds.length ? { attachmentIds } : {}),
              mode,
              text,
            },
            occurrence: this.newId(),
          };
    this.text = "";
    this.files = [];
    this.retry = null;
    this.restoreNext();
    this.emit();
    return delivery;
  }

  restore(delivery: MessageDelivery): void {
    this.waiting.push(delivery);
    this.restoreNext();
    this.emit();
  }

  private restoreNext(): void {
    if (this.text || this.files.length) {
      return;
    }
    const delivery = this.waiting.shift();
    if (delivery) {
      this.text = delivery.input.text;
      this.files = delivery.attachments ?? [];
      this.retry = delivery;
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
