export type ToastTone = "danger" | "info" | "success" | "warning";

export interface ToastMessage {
  description?: string;
  id: string;
  title: string;
  tone: ToastTone;
}

let toasts: readonly ToastMessage[] = [];
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) {
    listener();
  }
};

export const toast = (message: Omit<ToastMessage, "id">) => {
  toasts = [...toasts, { ...message, id: crypto.randomUUID() }];
  emit();
};

export const dismissToast = (id: string) => {
  toasts = toasts.filter((item) => item.id !== id);
  emit();
};

export const subscribeToasts = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getToasts = () => toasts;

const EMPTY: readonly ToastMessage[] = [];
export const getServerToasts = () => EMPTY;
