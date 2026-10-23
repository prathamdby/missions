import type { DeliveryMode } from "@missions/protocol/common";

export interface MessageDelivery {
  input: { mode: DeliveryMode; text: string };
  occurrence: string;
}

/** Composer draft/failed-delivery ownership, independent of React scheduling. */
export class MessageDraft {
  private text = "";
  private retry: MessageDelivery | null = null;
  private readonly waiting: MessageDelivery[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly newId: () => string;

  constructor(newId: () => string = () => crypto.randomUUID()) {
    this.newId = newId;
  }

  snapshot = () => this.text;
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

  take(mode: DeliveryMode): MessageDelivery | null {
    const text = this.text.trim();
    if (!text) {
      return null;
    }
    const same =
      this.retry?.input.text === text && this.retry.input.mode === mode;
    const delivery =
      same && this.retry
        ? this.retry
        : { input: { mode, text }, occurrence: this.newId() };
    this.text = "";
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
    if (this.text) {
      return;
    }
    const delivery = this.waiting.shift();
    if (delivery) {
      this.text = delivery.input.text;
      this.retry = delivery;
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
