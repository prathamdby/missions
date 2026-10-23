"use client";

import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { createContext, use } from "react";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

const kbdVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-xs font-mono text-2xs font-book",
  {
    defaultVariants: { size: "md", surface: "overlay" },
    variants: {
      size: {
        md: "h-5 min-w-5 px-[5px] leading-xs text-text-secondary shadow-[inset_0_-1px_0_var(--color-shadow),0_0_0_1px_var(--color-border)]",
        sm: "h-4.5 min-w-4.5 px-xs leading-xs text-text-secondary shadow-[inset_0_-1px_0_var(--color-shadow),0_0_0_1px_var(--color-border)]",
        xs: "h-4 min-w-4 px-xs leading-[12px] text-text-tertiary shadow-[0_0_0_1px_var(--color-border)]",
      },
      surface: {
        active: "bg-surface-active",
        overlay: "bg-surface-overlay",
      },
    },
  }
);

type KbdSizeName = NonNullable<VariantProps<typeof kbdVariants>["size"]>;

/** Default key cap size for a region, so a composer legend can use 18px caps without touching each Kbd. */
export const KbdSizeContext = createContext<KbdSizeName>("md");

/** Key cap. `md` (20px) sits in menus and fields, `sm` (18px) in composer hints, `xs` (16px) inside tooltips. */
export const Kbd = ({
  className,
  size,
  surface,
  ...props
}: ComponentProps<"kbd"> & VariantProps<typeof kbdVariants>) => {
  const contextSize = use(KbdSizeContext);
  return (
    <kbd
      className={cn(
        kbdVariants({ size: size ?? contextSize, surface }),
        className
      )}
      {...props}
    />
  );
};
