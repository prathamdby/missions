"use client";

import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { IconButton } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const contentVariants = cva(
  "fixed top-1/2 left-1/2 z-dialog flex max-h-[min(720px,calc(100dvh-2rem))] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl bg-surface-raised shadow-lg outline-none",
  {
    defaultVariants: { size: "md" },
    variants: {
      size: {
        lg: "max-w-chat",
        md: "max-w-prose",
      },
    },
  }
);

type DialogContentProps = ComponentProps<typeof DialogPrimitive.Content> &
  VariantProps<typeof contentVariants> & { hideClose?: boolean };

export const DialogContent = ({
  children,
  className,
  hideClose = false,
  size,
  ...props
}: DialogContentProps) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-dialog bg-shadow" />
    <DialogPrimitive.Content
      className={cn(contentVariants({ size }), className)}
      data-slot="dialog-content"
      {...props}
    >
      {children}
      {hideClose ? null : (
        <DialogPrimitive.Close asChild>
          <IconButton
            className="absolute top-lg right-lg"
            icon={<XIcon />}
            label="Close"
            size="sm"
          />
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
);

export const DialogHeader = ({
  className,
  ...props
}: ComponentProps<"div">) => (
  <div
    className={cn("flex flex-col gap-xs px-xl pt-xl pr-4xl pb-lg", className)}
    data-slot="dialog-header"
    {...props}
  />
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
    className={cn("type-caption text-text-secondary", className)}
    {...props}
  />
);

export const DialogBody = ({ className, ...props }: ComponentProps<"div">) => (
  <div
    className={cn(
      "flex min-h-0 flex-1 flex-col gap-lg overflow-y-auto px-xl pb-xl",
      className
    )}
    data-slot="dialog-body"
    {...props}
  />
);

export const DialogFooter = ({
  className,
  ...props
}: ComponentProps<"div">) => (
  <div
    className={cn(
      "flex flex-wrap items-center justify-end gap-md border-t border-border-subtle px-xl py-lg",
      className
    )}
    data-slot="dialog-footer"
    {...props}
  />
);
