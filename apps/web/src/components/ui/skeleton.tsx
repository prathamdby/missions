import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export const Skeleton = ({ className, ...props }: ComponentProps<"div">) => (
  <div
    aria-hidden="true"
    className={cn(
      "h-4 animate-skeleton rounded-sm bg-surface-overlay",
      className
    )}
    data-slot="skeleton"
    {...props}
  />
);
