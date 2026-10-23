"use client";

import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;
export const SelectGroup = SelectPrimitive.Group;

export const SelectTrigger = ({
  children,
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.Trigger>) => (
  <SelectPrimitive.Trigger
    className={cn(
      "inline-flex h-7 min-w-0 cursor-pointer items-center justify-between gap-sm rounded-sm bg-surface-overlay px-md text-sm text-text shadow-[inset_0_0_0_1px_var(--color-border)] transition-colors duration-fast hover:bg-surface-active focus-visible:shadow-focus disabled:text-text-disabled data-[placeholder]:text-text-tertiary [&>span]:truncate",
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDownIcon className="size-3.5 shrink-0 text-text-tertiary" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
);

export const SelectContent = ({
  children,
  className,
  position = "popper",
  ...props
}: ComponentProps<typeof SelectPrimitive.Content>) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      className={cn(
        "z-popover max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md bg-surface-overlay text-text shadow-lg",
        className
      )}
      position={position}
      sideOffset={6}
      {...props}
    >
      <SelectPrimitive.Viewport className="p-xs">
        {children}
      </SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
);

export const SelectItem = ({
  children,
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item>) => (
  <SelectPrimitive.Item
    className={cn(
      "relative flex cursor-pointer items-center gap-md rounded-sm py-sm pr-3xl pl-md text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:text-text-disabled data-[highlighted]:bg-surface-active",
      className
    )}
    {...props}
  >
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    <SelectPrimitive.ItemIndicator className="absolute right-md">
      <CheckIcon className="size-4 text-text-secondary" />
    </SelectPrimitive.ItemIndicator>
  </SelectPrimitive.Item>
);
