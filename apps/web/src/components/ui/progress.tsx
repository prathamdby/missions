import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

const progressVariants = cva(
  "block h-xs w-full shrink-0 appearance-none overflow-hidden rounded-full bg-surface-active [&::-moz-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-surface-active [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:transition-[width] [&::-webkit-progress-value]:duration-base",
  {
    defaultVariants: { tone: "accent" },
    variants: {
      tone: {
        accent:
          "[&::-moz-progress-bar]:bg-accent [&::-webkit-progress-value]:bg-accent",
        muted:
          "[&::-moz-progress-bar]:bg-text-tertiary [&::-webkit-progress-value]:bg-text-tertiary",
      },
    },
  }
);

/** 4px bar on a quiet track: accent for work in progress (NZJ), muted for a countdown (UL7). `value` is 0 to 100. */
export const ProgressBar = ({
  className,
  label,
  tone,
  value,
  ...props
}: Omit<ComponentProps<"progress">, "max" | "value"> &
  VariantProps<typeof progressVariants> & {
    label: string;
    value: number;
  }) => (
  <progress
    aria-label={label}
    className={cn(progressVariants({ tone }), className)}
    max={100}
    value={Math.min(100, Math.max(0, value))}
    {...props}
  />
);
