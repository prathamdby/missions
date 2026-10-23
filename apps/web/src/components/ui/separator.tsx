"use client";

import { Separator as SeparatorPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export const Separator = ({
  className,
  decorative = true,
  orientation = "horizontal",
  ...props
}: ComponentProps<typeof SeparatorPrimitive.Root>) => (
  <SeparatorPrimitive.Root
    className={cn(
      "shrink-0 bg-border-subtle",
      orientation === "horizontal" ? "h-px w-full" : "h-4 w-px bg-border",
      className
    )}
    decorative={decorative}
    orientation={orientation}
    {...props}
  />
);
