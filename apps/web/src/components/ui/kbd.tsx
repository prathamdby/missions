import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export const Kbd = ({ className, ...props }: ComponentProps<"kbd">) => (
  <kbd
    className={cn(
      "inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-xs bg-surface-overlay px-xs font-mono text-2xs leading-xs text-text-secondary shadow-[inset_0_0_0_1px_var(--color-border)]",
      className
    )}
    {...props}
  />
);
