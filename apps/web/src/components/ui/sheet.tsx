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
  "fixed z-panel flex flex-col overflow-hidden bg-surface-raised shadow-lg outline-none",
  {
    defaultVariants: { side: "left" },
    variants: {
      side: {
        bottom:
          "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-xl pb-[env(safe-area-inset-bottom)]",
        left: "inset-y-0 left-0 w-[80vw] max-w-80 rounded-r-xl",
        right: "inset-y-0 right-0 w-[92vw] max-w-panel rounded-l-xl",
      },
    },
  }
);

export const SheetContent = ({
  className,
  side,
  ...props
}: ComponentProps<typeof SheetPrimitive.Content> &
  VariantProps<typeof sheetVariants>) => (
  <SheetPrimitive.Portal>
    <SheetPrimitive.Overlay className="fixed inset-0 z-panel bg-shadow" />
    <SheetPrimitive.Content
      className={cn(sheetVariants({ side }), className)}
      data-slot="sheet-content"
      {...props}
    />
  </SheetPrimitive.Portal>
);
