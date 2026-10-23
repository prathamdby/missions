"use client";

import { Tabs as TabsPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

export const TabsList = ({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.List>) => (
  <TabsPrimitive.List
    className={cn("flex items-center gap-xs", className)}
    {...props}
  />
);

export const TabsTrigger = ({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Trigger>) => (
  <TabsPrimitive.Trigger
    className={cn(
      "inline-flex h-7 cursor-pointer items-center gap-sm rounded-sm px-md text-sm leading-sm font-medium tracking-tight text-text-secondary transition-colors duration-fast hover:text-text focus-visible:shadow-focus data-[state=active]:bg-surface-active data-[state=active]:text-text",
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
    className={cn("min-h-0 flex-1 outline-none", className)}
    {...props}
  />
);
