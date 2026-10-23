"use client";

import { CheckIcon } from "lucide-react";
import {
  Checkbox as CheckboxPrimitive,
  RadioGroup as RadioPrimitive,
  Switch as SwitchPrimitive,
} from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

const control =
  "shrink-0 cursor-pointer transition-[background-color,box-shadow] duration-base ease-out focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-disabled";

export const Switch = ({
  className,
  ...props
}: ComponentProps<typeof SwitchPrimitive.Root>) => (
  <SwitchPrimitive.Root
    className={cn(
      control,
      "inline-flex h-4.5 w-8 items-center rounded-full bg-surface-active p-2xs shadow-[inset_0_0_0_1px_var(--color-border-strong)] data-[state=checked]:bg-accent data-[state=checked]:shadow-none",
      className
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="block size-3.5 rounded-full bg-text-secondary transition-transform duration-base ease-out data-[state=checked]:translate-x-3.5 data-[state=checked]:bg-on-accent" />
  </SwitchPrimitive.Root>
);

export const Checkbox = ({
  className,
  ...props
}: ComponentProps<typeof CheckboxPrimitive.Root>) => (
  <CheckboxPrimitive.Root
    className={cn(
      control,
      "inline-flex size-4 items-center justify-center rounded-xs bg-surface-overlay shadow-[inset_0_0_0_1px_var(--color-border-strong)] data-[state=checked]:bg-accent data-[state=checked]:shadow-none",
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="text-on-accent">
      <CheckIcon className="size-3" strokeWidth={3} />
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
      "inline-flex size-4 items-center justify-center rounded-full bg-surface-overlay shadow-[inset_0_0_0_1px_var(--color-border-strong)] data-[state=checked]:shadow-[inset_0_0_0_1px_var(--color-accent)]",
      className
    )}
    {...props}
  >
    <RadioPrimitive.Indicator className="size-2 rounded-full bg-accent" />
  </RadioPrimitive.Item>
);
