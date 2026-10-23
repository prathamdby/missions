import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

const dotVariants = cva("inline-block shrink-0 rounded-full", {
  defaultVariants: { size: "status", tone: "success" },
  variants: {
    size: {
      /** 3px separator between metadata items. */
      separator: "size-[3px]",
      /** 6px state dot (clean, signed out). */
      status: "size-sm",
    },
    tone: {
      accent: "bg-accent",
      danger: "bg-danger",
      disabled: "bg-text-disabled",
      success: "bg-success",
      tertiary: "bg-text-tertiary",
      warning: "bg-warning",
    },
  },
});

/** Small round marker: a metadata separator or a state dot. */
export const Dot = ({
  className,
  size,
  tone,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof dotVariants>) => (
  <span
    aria-hidden="true"
    className={cn(
      dotVariants({
        size,
        tone: tone ?? (size === "separator" ? "disabled" : tone),
      }),
      className
    )}
    {...props}
  />
);
