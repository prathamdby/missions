"use client";

import { Tabs as TabsPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { CloseIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

export const TabsList = ({
  className,
  variant = "default",
  ...props
}: ComponentProps<typeof TabsPrimitive.List> & {
  variant?: "conversation" | "default";
}) => (
  <TabsPrimitive.List
    className={cn(
      "flex items-center",
      variant === "conversation" ? "gap-2xs" : "gap-xs",
      className
    )}
    {...props}
    tabIndex={-1}
  />
);

export const TabsTrigger = ({
  className,
  variant = "default",
  ...props
}: ComponentProps<typeof TabsPrimitive.Trigger> & {
  variant?: "conversation" | "default";
}) => (
  <TabsPrimitive.Trigger
    className={cn(
      "inline-flex h-7 cursor-pointer items-center rounded-sm text-sm leading-sm font-medium tracking-tight text-text-secondary transition-colors duration-fast hover:text-text focus-visible:shadow-focus data-[state=active]:bg-surface-active data-[state=active]:text-text",
      variant === "conversation"
        ? "shrink-0 gap-md px-control"
        : "gap-sm px-md",
      className
    )}
    {...props}
  />
);

export const TabsContent = ({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Content>) => (
  <TabsPrimitive.Content
    className={cn("relative min-h-0 flex-1 outline-none", className)}
    {...props}
    tabIndex={-1}
  />
);

/** Close is a sibling control, never a button inside the tab button. */
export const ConversationTab = ({
  children,
  label,
  onClose,
  selected,
  value,
}: {
  children: ComponentProps<"button">["children"];
  label: string;
  onClose?: () => void;
  selected: boolean;
  value: string;
}) => (
  <div
    className={cn(
      "group/conversation relative flex shrink-0 items-center rounded-sm",
      selected && "bg-surface-active"
    )}
  >
    <TabsTrigger
      className={onClose ? "pr-3xl" : undefined}
      value={value}
      variant="conversation"
    >
      {children}
    </TabsTrigger>
    {onClose ? (
      <button
        aria-label={`Close ${label} conversation`}
        className={cn(
          "pointer-events-none absolute right-xs flex size-5 cursor-pointer items-center justify-center rounded-xs text-text-tertiary opacity-0 group-focus-within/conversation:pointer-events-auto group-focus-within/conversation:opacity-100 group-hover/conversation:pointer-events-auto group-hover/conversation:opacity-100 hover:bg-surface-overlay hover:text-text focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:shadow-focus",
          selected &&
            "[@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
        )}
        onClick={onClose}
        type="button"
      >
        <CloseIcon className="size-3" />
      </button>
    ) : null}
  </div>
);
