"use client";

import { XIcon } from "lucide-react";
import { Toast as ToastPrimitive } from "radix-ui";
import { useSyncExternalStore } from "react";

import { IconButton } from "@/components/ui/button";
import {
  dismissToast,
  getServerToasts,
  getToasts,
  subscribeToasts,
} from "@/lib/toast-store";
import type { ToastTone } from "@/lib/toast-store";
import { cn } from "@/lib/utils";

const TONE: Record<ToastTone, string> = {
  danger: "bg-danger",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
};

export const Toaster = () => {
  const items = useSyncExternalStore(
    subscribeToasts,
    getToasts,
    getServerToasts
  );
  return (
    <ToastPrimitive.Provider duration={6000} swipeDirection="right">
      {items.map((item) => (
        <ToastPrimitive.Root
          className="flex w-full items-start gap-lg rounded-md bg-surface-overlay p-lg shadow-lg"
          key={item.id}
          onOpenChange={(open) => {
            if (!open) {
              dismissToast(item.id);
            }
          }}
          type={item.tone === "danger" ? "foreground" : "background"}
        >
          <span
            aria-hidden="true"
            className={cn(
              "mt-sm size-1.5 shrink-0 rounded-full",
              TONE[item.tone]
            )}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-2xs">
            <ToastPrimitive.Title className="type-label text-text">
              {item.title}
            </ToastPrimitive.Title>
            {item.description ? (
              <ToastPrimitive.Description className="type-caption text-text-secondary">
                {item.description}
              </ToastPrimitive.Description>
            ) : null}
          </div>
          <ToastPrimitive.Close asChild>
            <IconButton icon={<XIcon />} label="Dismiss" size="sm" />
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
      ))}
      <ToastPrimitive.Viewport className="fixed right-0 bottom-0 z-toast flex w-full max-w-96 flex-col gap-md p-xl outline-none" />
    </ToastPrimitive.Provider>
  );
};
