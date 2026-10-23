import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

const iconTileVariants = cva(
  "flex shrink-0 items-center justify-center [&_svg]:shrink-0",
  {
    defaultVariants: { size: "sm", tone: "neutral" },
    variants: {
      size: {
        /** 44px raised hero mark above an empty or sign-in state (NNV). */
        hero: "size-11 rounded-md bg-surface-overlay shadow-[inset_0_1px_0_var(--color-highlight),0_0_0_1px_var(--color-border),0_1px_2px_var(--color-shadow),0_2px_6px_var(--color-shadow)]",
        /** 28px tinted square leading a selection summary (MHN, MW0). */
        sm: "size-7 rounded-sm",
      },
      tone: {
        neutral: "bg-surface-active text-text-secondary",
        raised: "",
        success: "bg-success-muted text-success",
        /** Sits on a warning-muted band, so it is one step stronger. */
        warning: "bg-warning/15 text-warning",
      },
    },
  }
);

/** Square holder for one icon. */
export const IconTile = ({
  className,
  size,
  tone,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof iconTileVariants>) => (
  <span
    aria-hidden="true"
    className={cn(iconTileVariants({ size, tone }), className)}
    {...props}
  />
);
