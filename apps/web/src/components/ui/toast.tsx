"use client";

import Link from "next/link";
import { Toast as ToastPrimitive } from "radix-ui";
import { useSyncExternalStore } from "react";

import { AlertIcon, CheckIcon, CloseIcon } from "@/components/ui/icons";
import {
  dismissToast,
  getServerToasts,
  getToasts,
  subscribeToasts,
} from "@/lib/toast-store";
import type { ToastTone } from "@/lib/toast-store";

const ToneIcon = ({ tone }: { tone: ToastTone }) => {
  if (tone === "success") {
    return <CheckIcon tone="success" />;
  }
  if (tone === "info") {
    return (
      <span className="flex size-4 items-center justify-center">
        <span className="size-sm rounded-full bg-info" />
      </span>
    );
  }
  return <AlertIcon tone={tone} />;
};

/** OZS: 360px raised card, bottom right. */
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
          className="flex w-full items-start gap-control rounded-md bg-surface-overlay p-lg shadow-lg"
          key={item.id}
          onOpenChange={(open) => {
            if (!open) {
              dismissToast(item.id);
            }
          }}
          type={item.tone === "danger" ? "foreground" : "background"}
        >
          <span aria-hidden="true" className="shrink-0 pt-hairline">
            <ToneIcon tone={item.tone} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-2xs">
            <ToastPrimitive.Title className="text-sm leading-sm font-medium tracking-tight text-text">
              {item.title}
            </ToastPrimitive.Title>
            {item.description ? (
              <ToastPrimitive.Description className="text-xs leading-sm font-book tracking-tight text-text-tertiary">
                {item.description}
              </ToastPrimitive.Description>
            ) : null}
          </div>
          {item.action ? (
            <ToastPrimitive.Action altText={item.action.label} asChild>
              <Link
                className="shrink-0 rounded-xs text-sm leading-sm font-medium tracking-tight text-text outline-none hover:text-text-secondary focus-visible:shadow-focus"
                href={item.action.href}
              >
                {item.action.label}
              </Link>
            </ToastPrimitive.Action>
          ) : null}
          <ToastPrimitive.Close
            aria-label="Dismiss"
            className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-xs text-text-tertiary outline-none hover:text-text focus-visible:shadow-focus"
          >
            <CloseIcon size="sm" />
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
      ))}
      <ToastPrimitive.Viewport className="fixed right-0 bottom-0 z-toast flex w-full max-w-[408px] flex-col gap-md p-2xl outline-none" />
    </ToastPrimitive.Provider>
  );
};
