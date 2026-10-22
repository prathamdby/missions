import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-sm rounded-sm type-label transition-colors duration-fast ease-out",
  {
    defaultVariants: { size: "md", variant: "secondary" },
    variants: {
      size: {
        md: "h-8 px-lg",
        sm: "h-7 px-md",
      },
      variant: {
        primary: "bg-accent text-on-accent hover:bg-accent-hover",
        secondary:
          "bg-surface-overlay text-text shadow-button hover:bg-surface-active",
      },
    },
  }
);

export const Button = ({
  className,
  size,
  variant,
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants>) => (
  <button
    className={buttonVariants({ className, size, variant })}
    type="button"
    {...props}
  />
);
