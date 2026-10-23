"use client";

import { ChevronRightIcon } from "lucide-react";
import { Collapsible as CollapsiblePrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export const Collapsible = CollapsiblePrimitive.Root;
export const CollapsibleContent = CollapsiblePrimitive.Content;

/** Quiet disclosure row: chevron, then the summary. */
export const CollapsibleRow = ({
  children,
  className,
  ...props
}: ComponentProps<typeof CollapsiblePrimitive.Trigger>) => (
  <CollapsiblePrimitive.Trigger
    className={cn(
      "group/row flex w-full min-w-0 cursor-pointer items-center gap-md rounded-sm py-xs text-left text-sm leading-md text-text-tertiary transition-colors duration-fast hover:text-text-secondary focus-visible:shadow-focus [&>svg]:size-4 [&>svg]:shrink-0",
      className
    )}
    {...props}
  >
    {children}
    <ChevronRightIcon
      aria-hidden="true"
      className="size-3.5 shrink-0 transition-transform duration-fast group-data-[state=open]/row:rotate-90"
    />
  </CollapsiblePrimitive.Trigger>
);
