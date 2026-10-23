"use client";

import { Tooltip as TooltipPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

export const TooltipProvider = ({
  delayDuration = 300,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Provider>) => (
  <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />
);

export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = ({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      className={cn(
        "z-tooltip max-w-72 rounded-sm bg-surface-active px-md py-xs text-xs leading-sm text-text shadow-lg",
        className
      )}
      collisionPadding={8}
      sideOffset={sideOffset}
      {...props}
    />
  </TooltipPrimitive.Portal>
);

/** Wraps a focusable child with a short hover and focus hint. */
export const Hint = ({
  children,
  label,
  side = "top",
}: {
  children: ReactNode;
  label: ReactNode;
  side?: "bottom" | "left" | "right" | "top";
}) => (
  <Tooltip>
    <TooltipTrigger asChild>{children}</TooltipTrigger>
    <TooltipContent side={side}>{label}</TooltipContent>
  </Tooltip>
);
