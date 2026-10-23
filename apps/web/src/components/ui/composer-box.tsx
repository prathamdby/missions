"use client";

import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { KbdSizeContext } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

const composerBoxVariants = cva(
  "flex flex-col gap-md rounded-2xl bg-surface-raised pr-md pb-md pl-card shadow-md transition-[box-shadow,opacity] duration-fast has-[textarea:focus-visible]:shadow-composer-focus",
  {
    defaultVariants: { size: "responsive" },
    variants: {
      size: {
        /** 96px tall so the toolbar sits at the bottom of an empty box. */
        md: "min-h-24 pt-card",
        /** `md` on desktop, `touch` below the md breakpoint (YL0). */
        responsive: "pt-lg md:min-h-24 md:pt-card",
        touch: "pt-lg",
      },
    },
  }
);

/** Raised rounded box around a composer field and its toolbar. `inert` dims it to 50%. */
export const ComposerBox = ({
  className,
  inert,
  size,
  ...props
}: ComponentProps<"div"> & VariantProps<typeof composerBoxVariants>) => (
  <div
    className={cn(
      composerBoxVariants({ size }),
      inert && "opacity-50",
      className
    )}
    data-slot="composer-box"
    inert={inert}
    {...props}
  />
);

/** Bottom row of a composer: icon buttons, chips, spacer, send. */
export const ComposerToolbar = ({
  className,
  ...props
}: ComponentProps<"div">) => (
  <div
    className={cn("mt-auto -ml-sm flex items-center gap-xs", className)}
    data-slot="composer-toolbar"
    {...props}
  />
);

/** Keyboard legend under a composer. Children are groups; groups sit 22px apart. */
export const ComposerLegend = ({
  className,
  ...props
}: ComponentProps<"div">) => (
  <KbdSizeContext value="sm">
    <div
      className={cn(
        "hidden flex-wrap items-center justify-center gap-x-sm gap-y-xs text-xs leading-sm font-book tracking-tight text-text-tertiary md:flex [&>*]:flex [&>*]:items-center [&>*]:gap-sm [&>*+*]:ml-xl",
        className
      )}
      data-slot="composer-legend"
      {...props}
    />
  </KbdSizeContext>
);
