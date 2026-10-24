"use client";

import { Tabs as TabsPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

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
  />
);
