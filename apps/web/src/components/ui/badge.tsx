import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex shrink-0 items-center gap-sm font-medium tracking-tight whitespace-nowrap",
  {
    defaultVariants: { size: "md", tone: "neutral" },
    variants: {
      size: {
        md: "h-5.5 rounded-full px-md text-xs leading-sm",
        sm: "h-4.5 rounded-xs px-xs text-2xs leading-xs",
      },
      tone: {
        accent: "bg-accent-muted text-accent-text",
        danger: "bg-danger-muted text-danger",
        info: "bg-info-muted text-info",
        muted: "bg-surface-active text-text-secondary",
        neutral:
          "text-text-secondary shadow-[inset_0_0_0_1px_var(--color-border-strong)]",
        quiet:
          "text-text-tertiary shadow-[inset_0_0_0_1px_var(--color-border)]",
        success: "bg-success-muted text-success",
        warning: "bg-warning-muted text-warning",
      },
    },
  }
);

const dotTone = {
  accent: "bg-accent",
  danger: "bg-danger",
  info: "bg-info",
  muted: "bg-text-secondary",
  neutral: "bg-text-tertiary",
  quiet: "bg-text-disabled",
  success: "bg-success",
  warning: "bg-warning",
} as const;

export type BadgeTone = keyof typeof dotTone;

type BadgeProps = ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { dot?: boolean };

/** Status pill. `dot` adds the leading status dot used for mission and agent states. */
export const Badge = ({
  children,
  className,
  dot = false,
  size,
  tone,
  ...props
}: BadgeProps) => (
  <span
    className={cn(badgeVariants({ size, tone }), className)}
    data-slot="badge"
    {...props}
  >
    {dot ? (
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          dotTone[tone ?? "neutral"]
        )}
      />
    ) : null}
    {children}
  </span>
);

/** Monospace chip for IDs, counts, and refs. */
export const Tag = ({ className, ...props }: ComponentProps<"span">) => (
  <span
    className={cn(
      "inline-flex h-5.5 shrink-0 items-center gap-sm rounded-full bg-surface-overlay px-md font-mono text-xs leading-sm font-medium text-text-secondary",
      className
    )}
    data-slot="tag"
    {...props}
  />
);

export const DiffStat = ({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) => (
  <span className="inline-flex h-5.5 shrink-0 items-center gap-xs rounded-xs bg-surface-overlay px-sm font-mono text-xs leading-sm">
    <span className="text-success">+{additions}</span>
    <span className="text-danger">-{deletions}</span>
  </span>
);
