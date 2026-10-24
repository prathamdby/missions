"use client";

import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

export const TooltipProvider = ({
  delayDuration = 500,
  skipDelayDuration = 300,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Provider>) => (
  <TooltipPrimitive.Provider
    delayDuration={delayDuration}
    skipDelayDuration={skipDelayDuration}
    {...props}
  />
);

export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

const tooltipVariants = cva(
  "z-tooltip rounded-sm bg-surface-active text-xs leading-sm tracking-tight text-text shadow-md",
  {
    defaultVariants: { variant: "default" },
    variants: {
      variant: {
        /** One line: label and an optional key cap. */
        default: "flex min-h-7 max-w-80 items-center gap-md px-md font-medium",
      },
    },
  }
);

export const TooltipContent = ({
  className,
  sideOffset = 8,
  variant,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content> &
  VariantProps<typeof tooltipVariants>) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      className={cn(tooltipVariants({ variant }), className)}
      collisionPadding={8}
      sideOffset={sideOffset}
      {...props}
    />
  </TooltipPrimitive.Portal>
);

/** Wraps a focusable child with a short hover and focus hint. */
export const Hint = ({
  children,
  disabled = false,
  label,
  side = "top",
}: {
  children: ReactNode;
  disabled?: boolean;
  label: ReactNode;
  side?: "bottom" | "left" | "right" | "top";
}) => (
  <Tooltip open={disabled ? false : undefined}>
    <TooltipTrigger asChild>{children}</TooltipTrigger>
    <TooltipContent side={side}>{label}</TooltipContent>
  </Tooltip>
);
