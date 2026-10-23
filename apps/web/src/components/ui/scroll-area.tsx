"use client";

import { ScrollArea as ScrollPrimitive } from "radix-ui";
import type { ComponentProps, Ref } from "react";

import { cn } from "@/lib/utils";

type ScrollAreaProps = ComponentProps<typeof ScrollPrimitive.Root> & {
  viewportRef?: Ref<HTMLDivElement>;
  viewportLabel?: string;
};

export const ScrollArea = ({
  children,
  className,
  viewportLabel,
  viewportRef,
  ...props
}: ScrollAreaProps) => (
  <ScrollPrimitive.Root
    className={cn("relative min-h-0 overflow-hidden", className)}
    data-slot="scroll-area"
    type="hover"
    {...props}
  >
    <ScrollPrimitive.Viewport
      aria-label={viewportLabel}
      className="size-full rounded-[inherit] focus-visible:shadow-focus [&>div]:block!"
      ref={viewportRef}
      tabIndex={viewportLabel ? 0 : undefined}
    >
      {children}
    </ScrollPrimitive.Viewport>
    <ScrollPrimitive.Scrollbar
      className="flex w-2 touch-none p-2xs transition-colors duration-fast select-none"
      orientation="vertical"
    >
      <ScrollPrimitive.Thumb className="relative flex-1 rounded-full bg-border-strong" />
    </ScrollPrimitive.Scrollbar>
    <ScrollPrimitive.Corner />
  </ScrollPrimitive.Root>
);
