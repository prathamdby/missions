"use client";

import {
  Checkbox as CheckboxPrimitive,
  RadioGroup as RadioPrimitive,
  Switch as SwitchPrimitive,
} from "radix-ui";
import type { ComponentProps } from "react";

import { CheckIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

const control =
  "shrink-0 cursor-pointer outline-none transition-[background-color,box-shadow] duration-base ease-out focus-visible:shadow-focus disabled:cursor-not-allowed";

export const Switch = ({
  className,
  ...props
}: ComponentProps<typeof SwitchPrimitive.Root>) => (
  <SwitchPrimitive.Root
    className={cn(
      control,
      "group/switch inline-flex h-4.5 w-8 items-center rounded-full bg-surface-active p-2xs shadow-[inset_0_0_0_1px_var(--color-border)] disabled:bg-surface disabled:shadow-[inset_0_0_0_1px_var(--color-border)] data-[state=checked]:bg-accent data-[state=checked]:shadow-none",
      className
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="block size-3.5 rounded-full bg-text-secondary shadow-[0_1px_2px_var(--color-shadow)] transition-transform duration-base ease-out group-disabled/switch:bg-text-disabled data-[state=checked]:translate-x-3.5 data-[state=checked]:bg-text" />
  </SwitchPrimitive.Root>
);

export const Checkbox = ({
  className,
  ...props
}: ComponentProps<typeof CheckboxPrimitive.Root>) => (
  <CheckboxPrimitive.Root
    className={cn(
      control,
      "group/checkbox inline-flex size-4 items-center justify-center rounded-[4px] bg-surface-raised shadow-[inset_0_0_0_1px_var(--color-border-strong)] disabled:bg-surface disabled:shadow-[inset_0_0_0_1px_var(--color-border)] data-[state=checked]:bg-accent data-[state=checked]:shadow-none data-[state=indeterminate]:bg-accent data-[state=indeterminate]:shadow-none",
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-on-accent">
      <CheckIcon
        className="group-data-[state=indeterminate]/checkbox:hidden"
        size="xs"
      />
      <span className="hidden h-0.5 w-2 rounded-full bg-on-accent group-data-[state=indeterminate]/checkbox:block" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
);

export const RadioGroup = ({
  className,
  ...props
}: ComponentProps<typeof RadioPrimitive.Root>) => (
  <RadioPrimitive.Root
    className={cn("flex flex-col gap-xs", className)}
    {...props}
  />
);

export const RadioGroupItem = ({
  className,
  ...props
}: ComponentProps<typeof RadioPrimitive.Item>) => (
  <RadioPrimitive.Item
    className={cn(
      control,
      "inline-flex size-4 items-center justify-center rounded-full bg-surface-raised shadow-[inset_0_0_0_1px_var(--color-border-strong)] disabled:bg-surface disabled:shadow-[inset_0_0_0_1px_var(--color-border)] data-[state=checked]:bg-accent data-[state=checked]:shadow-none",
      className
    )}
    {...props}
  >
    <RadioPrimitive.Indicator className="size-sm rounded-full bg-on-accent" />
  </RadioPrimitive.Item>
);
