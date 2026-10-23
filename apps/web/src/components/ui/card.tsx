import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

const cardVariants = cva("flex min-w-0 flex-col rounded-md", {
  defaultVariants: { tone: "default" },
  variants: {
    tone: {
      default: "bg-surface-raised shadow-sm",
      inset: "bg-surface shadow-[inset_0_0_0_1px_var(--color-border)]",
      warning:
        "bg-surface-raised shadow-[inset_0_0_0_1px_var(--color-warning-muted),var(--shadow-sm)]",
    },
  },
});

export const Card = ({
  className,
  tone,
  ...props
}: ComponentProps<"section"> & VariantProps<typeof cardVariants>) => (
  <section
    className={cn(cardVariants({ tone }), className)}
    data-slot="card"
    {...props}
  />
);

export const CardHeader = ({ className, ...props }: ComponentProps<"div">) => (
  <div
    className={cn(
      "flex min-h-11 items-center gap-md border-b border-border-subtle px-lg py-md",
      className
    )}
    data-slot="card-header"
    {...props}
  />
);

export const CardTitle = ({
  children,
  className,
  ...props
}: ComponentProps<"h3">) => (
  <h3
    className={cn("min-w-0 flex-1 truncate type-label text-text", className)}
    data-slot="card-title"
    {...props}
  >
    {children}
  </h3>
);

export const CardContent = ({ className, ...props }: ComponentProps<"div">) => (
  <div
    className={cn("flex flex-col gap-md px-lg py-md", className)}
    data-slot="card-content"
    {...props}
  />
);

export const CardFooter = ({ className, ...props }: ComponentProps<"div">) => (
  <div
    className={cn(
      "flex flex-wrap items-center gap-md border-t border-border-subtle px-lg py-md",
      className
    )}
    data-slot="card-footer"
    {...props}
  />
);
