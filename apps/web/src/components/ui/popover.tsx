"use client";

import { Popover as PopoverPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export const PopoverContent = ({
  align = "start",
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      align={align}
      className={cn(
        "z-popover flex max-h-[min(480px,var(--radix-popover-content-available-height))] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-md bg-surface-overlay text-text shadow-lg outline-none",
        className
      )}
      collisionPadding={8}
      sideOffset={sideOffset}
      {...props}
    />
  </PopoverPrimitive.Portal>
);
