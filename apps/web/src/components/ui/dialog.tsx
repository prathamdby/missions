"use client";

import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";

import { CloseIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const contentVariants = cva(
  "fixed top-1/2 left-1/2 z-dialog flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg bg-surface-raised text-text shadow-lg outline-none",
  {
    defaultVariants: { size: "md" },
    variants: {
      size: {
        /** 720px browsers and lists. */
        lg: "max-w-chat",
        /** 600px forms (clone from URL). */
        md: "max-w-150",
        /** 560px single-purpose flows (GitHub sign-in). */
        prose: "max-w-prose",
        /** 420px confirmations. */
        sm: "max-w-105",
        /** 680px repository lists (clone from GitHub). */
        wide: "max-w-170",
      },
    },
  }
);

type DialogContentProps = ComponentProps<typeof DialogPrimitive.Content> &
  VariantProps<typeof contentVariants>;

export const DialogContent = ({
  children,
  className,
  size,
  ...props
}: DialogContentProps) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-dialog bg-scrim" />
    <DialogPrimitive.Content
      className={cn(contentVariants({ size }), className)}
      data-slot="dialog-content"
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
);

/** Title block with the close button on the right, as every Paper dialog draws it. */
export const DialogHeader = ({
  aside,
  children,
  className,
  close = true,
  ...props
}: ComponentProps<"div"> & { aside?: ReactNode; close?: boolean }) => (
  <div
    className={cn(
      "flex shrink-0 items-start gap-lg px-gutter pt-field pb-card",
      className
    )}
    data-slot="dialog-header"
    {...props}
  >
    <div className="flex min-w-0 flex-1 flex-col gap-xs">{children}</div>
    {aside}
    {close ? (
      <DialogPrimitive.Close
        aria-label="Close"
        className="-mr-2xs flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-xs text-text-tertiary transition-colors duration-fast outline-none hover:bg-surface-overlay hover:text-text focus-visible:shadow-focus"
      >
        <CloseIcon />
      </DialogPrimitive.Close>
    ) : null}
  </div>
);

export const DialogTitle = ({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Title>) => (
  <DialogPrimitive.Title
    className={cn("type-heading text-text", className)}
    {...props}
  />
);

export const DialogDescription = ({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) => (
  <DialogPrimitive.Description
    className={cn("type-caption text-text-tertiary", className)}
    {...props}
  />
);

const sectionVariants = cva("flex shrink-0 flex-col", {
  defaultVariants: { divider: true, padding: "none" },
  variants: {
    divider: {
      false: "",
      true: "border-t border-border-subtle",
    },
    padding: {
      /** One labelled field under a list, e.g. "Clone to" (NAA). */
      field: "gap-sm px-gutter py-card",
      /** Forms: 16px top, 20px sides and bottom. */
      form: "gap-field px-gutter pt-xl pb-gutter",
      /** Centered empty and error states. */
      hero: "items-center gap-xl px-dialog-hero pt-section pb-3xl text-center",
      none: "",
      /** Failure reports: form padding with roomier gaps (OBV). */
      report: "gap-xl px-gutter pt-xl pb-gutter",
      /** One-line rows such as a selection summary or an alternate action. */
      row: "flex-row items-center gap-control px-gutter py-lg",
    },
    tone: {
      default: "",
      warning: "bg-warning-muted",
    },
  },
});

/** A band inside a dialog, separated from the one above by a hairline. */
export const DialogSection = ({
  className,
  divider,
  padding,
  tone,
  ...props
}: ComponentProps<"div"> & VariantProps<typeof sectionVariants>) => (
  <div
    className={cn(sectionVariants({ divider, padding, tone }), className)}
    data-slot="dialog-section"
    {...props}
  />
);

const pillTone = {
  danger: "bg-danger-muted text-danger",
  success: "bg-surface-active text-text-secondary",
  warning: "bg-warning-muted text-warning",
} as const;

const pillDot = {
  danger: "bg-danger",
  success: "bg-success",
  warning: "bg-warning",
} as const;

/** Status pill beside a dialog title, e.g. "gh · prathamd" (NAA, NNV). */
export const DialogPill = ({
  children,
  className,
  tone = "success",
  ...props
}: ComponentProps<"span"> & { tone?: keyof typeof pillTone }) => (
  <span
    className={cn(
      "mt-hairline inline-flex h-6 shrink-0 items-center gap-sm rounded-full px-md text-xs leading-sm font-medium tracking-tight whitespace-nowrap",
      pillTone[tone],
      className
    )}
    {...props}
  >
    <span
      aria-hidden="true"
      className={cn("size-sm shrink-0 rounded-full", pillDot[tone])}
    />
    {children}
  </span>
);

/** A whole band that acts as one button, e.g. "Clone from a URL instead" (NNV). */
export const DialogRowButton = ({
  className,
  type = "button",
  ...props
}: ComponentProps<"button">) => (
  <button
    className={cn(
      "flex w-full shrink-0 cursor-pointer items-center gap-control border-t border-border-subtle px-gutter py-lg text-left transition-colors duration-fast outline-none hover:bg-surface-overlay focus-visible:shadow-[inset_0_0_0_2px_var(--color-focus)] [&>svg]:shrink-0",
      className
    )}
    type={type === "submit" ? "submit" : "button"}
    {...props}
  />
);

export const DialogBody = ({ className, ...props }: ComponentProps<"div">) => (
  <div
    className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto", className)}
    data-slot="dialog-body"
    {...props}
  />
);

const footerVariants = cva("flex shrink-0 flex-wrap items-center gap-md", {
  defaultVariants: { variant: "bar" },
  variants: {
    variant: {
      /** Footer band on surface with a hairline above. */
      bar: "border-t border-border-subtle bg-surface px-gutter py-lg",
      /** Confirmation actions with no band. */
      plain: "justify-end",
    },
  },
});

export const DialogFooter = ({
  className,
  variant,
  ...props
}: ComponentProps<"div"> & VariantProps<typeof footerVariants>) => (
  <div
    className={cn(footerVariants({ variant }), className)}
    data-slot="dialog-footer"
    {...props}
  />
);
