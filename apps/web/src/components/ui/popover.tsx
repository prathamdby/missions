"use client";

import { Popover as PopoverPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

const WIDTH = {
  /** PNO workspace picker. */
  lg: "w-[min(400px,calc(100vw-2rem))]",
  /** LTT project picker. */
  md: "w-[min(380px,calc(100vw-2rem))]",
  /** PB7 branch picker. */
  sm: "w-[min(360px,calc(100vw-2rem))]",
} as const;

/** Paper menu surface (LTT, PB7, PNO) with 4px padding for menu rows. */
export const PopoverContent = ({
  align = "start",
  className,
  sideOffset = 6,
  size = "md",
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content> & {
  size?: keyof typeof WIDTH;
}) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      align={align}
      className={cn(
        "z-popover flex max-h-[min(520px,var(--radix-popover-content-available-height))] flex-col gap-hairline overflow-hidden rounded-md bg-surface-overlay p-xs text-text shadow-lg outline-none",
        WIDTH[size],
        className
      )}
      collisionPadding={8}
      sideOffset={sideOffset}
      {...props}
    />
  </PopoverPrimitive.Portal>
);

/** Full-bleed hairline between popover menu groups. */
export const PopoverSeparator = ({
  className,
  ...props
}: ComponentProps<"hr">) => (
  <hr
    className={cn(
      "-mx-xs my-xs h-px shrink-0 border-0 bg-border-subtle",
      className
    )}
    {...props}
  />
);

/** Small print at the bottom of a popover menu (PB7). */
export const PopoverNote = ({ className, ...props }: ComponentProps<"p">) => (
  <p
    className={cn(
      "shrink-0 px-md pt-sm pb-xs text-xs leading-sm font-book tracking-tight text-text-tertiary",
      className
    )}
    {...props}
  />
);

/** Search field docked to the top edge of a popover menu, with a hairline under it. */
export const PopoverSearch = ({
  className,
  inset = "md",
  ...props
}: ComponentProps<"div"> & { inset?: "lg" | "md" }) => (
  <div
    className={cn(
      inset === "lg" ? "px-lg" : "px-md",
      "-mx-xs -mt-xs mb-xs flex h-9 shrink-0 items-center gap-md border-b border-border-subtle text-text-tertiary [&_input]:min-w-0 [&_input]:flex-1 [&_input]:bg-transparent [&_input]:text-sm [&_input]:leading-sm [&_input]:font-book [&_input]:text-text [&_input]:outline-none [&_input]:placeholder:text-text-tertiary [&_input:focus-visible]:shadow-none",
      className
    )}
    {...props}
  />
);
