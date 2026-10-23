"use client";

import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import {
  CheckIcon as PaperCheckIcon,
  ChevronDownIcon as PaperChevronDownIcon,
} from "@/components/ui/icons";
import { cn } from "@/lib/utils";

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

type SelectAppearance = "default" | "model" | "thinking";
interface Appearance {
  appearance?: SelectAppearance;
}

export const SelectGroup = ({
  appearance = "default",
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.Group> & Appearance) => (
  <SelectPrimitive.Group
    className={cn(
      appearance !== "default" && "flex flex-col gap-hairline",
      className
    )}
    {...props}
  />
);

export const SelectTrigger = ({
  appearance = "default",
  children,
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.Trigger> & Appearance) => {
  const triggerProps = { ...props };
  if (appearance !== "default") {
    // Tooltip's asChild trigger supplies its own state. Paper chrome must use
    // Select's authoritative open/closed state, not tooltip hover/focus state.
    Reflect.deleteProperty(triggerProps, "data-state");
  }
  return (
    <SelectPrimitive.Trigger
      className={cn(
        appearance === "default"
          ? "inline-flex h-7 min-w-0 cursor-pointer items-center justify-between gap-sm rounded-sm bg-surface-overlay px-md text-sm text-text shadow-[inset_0_0_0_1px_var(--color-border)] transition-colors duration-fast hover:bg-surface-active focus-visible:shadow-focus disabled:text-text-disabled data-[placeholder]:text-text-tertiary [&>span]:truncate"
          : "flex h-7 shrink-0 cursor-pointer items-center gap-sm rounded-sm bg-surface-raised px-control text-text shadow-button transition-colors duration-fast outline-none hover:bg-surface-overlay focus-visible:shadow-focus disabled:cursor-not-allowed data-[state=open]:bg-surface-active data-[state=open]:shadow-button-active [&>span]:min-w-0 [&>span]:truncate",
        appearance === "model" &&
          "w-29 justify-between font-mono text-2xs leading-xs font-regular",
        appearance === "thinking" &&
          "w-36 text-xs leading-sm font-medium tracking-tight [&>span:first-child]:font-book [&>span:first-child]:text-text-tertiary [&>span:nth-child(2)]:flex-1 [&>span:nth-child(2)]:text-left",
        className
      )}
      {...triggerProps}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        {appearance === "default" ? (
          <ChevronDownIcon className="size-3.5 shrink-0 text-text-tertiary" />
        ) : (
          <PaperChevronDownIcon size="xs" tone="tertiary" />
        )}
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
};

export const SelectContent = ({
  appearance = "default",
  children,
  className,
  position = "popper",
  ...props
}: ComponentProps<typeof SelectPrimitive.Content> & Appearance) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      className={cn(
        "z-popover max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md bg-surface-overlay text-text shadow-lg",
        appearance === "model" && "w-50",
        appearance === "thinking" && "w-36",
        className
      )}
      position={position}
      sideOffset={6}
      collisionPadding={appearance === "default" ? undefined : 8}
      {...props}
    >
      <SelectPrimitive.Viewport
        className={cn(
          "p-xs",
          appearance !== "default" && "flex flex-col gap-hairline"
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
);

export const SelectItem = ({
  appearance = "default",
  children,
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item> & Appearance) => (
  <SelectPrimitive.Item
    className={cn(
      appearance === "default"
        ? "relative flex cursor-pointer items-center gap-md rounded-sm py-sm pr-3xl pl-md text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:text-text-disabled data-[highlighted]:bg-surface-active"
        : "flex shrink-0 cursor-pointer items-center rounded-xs px-md font-book tracking-tight text-text-secondary outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:text-text-disabled data-[highlighted]:bg-surface-active data-[state=checked]:bg-surface-active data-[state=checked]:text-text [&>span:first-child]:min-w-0 [&>span:first-child]:flex-1 [&>span:first-child]:truncate",
      appearance === "model" && "h-8 gap-control text-sm leading-sm",
      appearance === "thinking" &&
        "h-7 gap-md text-xs leading-sm data-[state=checked]:font-medium",
      className
    )}
    {...props}
  >
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    {appearance === "default" ? (
      <SelectPrimitive.ItemIndicator className="absolute right-md">
        <CheckIcon className="size-4 text-text-secondary" />
      </SelectPrimitive.ItemIndicator>
    ) : (
      <span
        aria-hidden="true"
        className={cn(
          "flex shrink-0 items-center justify-center",
          appearance === "model" ? "size-3.5" : "size-3"
        )}
      >
        <SelectPrimitive.ItemIndicator>
          <PaperCheckIcon
            size={appearance === "model" ? "sm" : "xs"}
            tone="text"
          />
        </SelectPrimitive.ItemIndicator>
      </span>
    )}
  </SelectPrimitive.Item>
);

/** Paper KXE: role heading in the grouped model menu. */
export const SelectLabel = ({
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.Label>) => (
  <SelectPrimitive.Label
    className={cn(
      "shrink-0 px-md pt-sm pb-xs text-xs leading-sm font-medium tracking-tight text-text-tertiary",
      className
    )}
    {...props}
  />
);
