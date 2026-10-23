"use client";

import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { Dialog as SheetPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export const Sheet = SheetPrimitive.Root;
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;
export const SheetTitle = SheetPrimitive.Title;
export const SheetDescription = SheetPrimitive.Description;

const sheetVariants = cva(
  "fixed z-panel flex flex-col overflow-hidden text-text shadow-lg outline-none",
  {
    defaultVariants: { side: "left" },
    variants: {
      side: {
        /** YWG: pickers on touch screens, with a grab handle. */
        bottom:
          "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-xl bg-surface-overlay px-md pt-md pb-[max(env(safe-area-inset-bottom),var(--spacing-lg))]",
        /** JD1: the navigation drawer. */
        left: "inset-y-0 left-0 w-78 max-w-[85vw] gap-xl rounded-tr-[16px] bg-surface px-lg pt-[max(env(safe-area-inset-top),var(--spacing-xs))] pb-[max(env(safe-area-inset-bottom),var(--spacing-drawer-bottom))]",
        right:
          "inset-y-0 right-0 w-[92vw] max-w-panel rounded-l-xl bg-surface-raised",
      },
    },
  }
);

export const SheetContent = ({
  children,
  className,
  side,
  ...props
}: ComponentProps<typeof SheetPrimitive.Content> &
  VariantProps<typeof sheetVariants>) => (
  <SheetPrimitive.Portal>
    <SheetPrimitive.Overlay className="fixed inset-0 z-panel bg-scrim-strong" />
    <SheetPrimitive.Content
      className={cn(sheetVariants({ side }), className)}
      data-slot="sheet-content"
      {...props}
    >
      {side === "bottom" ? (
        <span
          aria-hidden="true"
          className="flex shrink-0 justify-center pt-2xs pb-control"
        >
          <span className="h-[5px] w-9 rounded-full bg-border-strong" />
        </span>
      ) : null}
      {children}
    </SheetPrimitive.Content>
  </SheetPrimitive.Portal>
);
