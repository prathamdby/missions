import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { IconButton } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const calloutVariants = cva(
  "flex w-full min-w-0 gap-lg rounded-md p-lg text-left",
  {
    defaultVariants: { tone: "info" },
    variants: {
      tone: {
        danger:
          "bg-surface-raised shadow-[inset_0_0_0_1px_var(--color-danger-muted),var(--shadow-sm)] [&>svg]:text-danger",
        info: "bg-surface-raised shadow-sm [&>svg]:text-info",
        success:
          "bg-surface-raised shadow-[inset_0_0_0_1px_var(--color-success-muted),var(--shadow-sm)] [&>svg]:text-success",
        warning:
          "bg-surface-raised shadow-[inset_0_0_0_1px_var(--color-warning-muted),var(--shadow-sm)] [&>svg]:text-warning",
      },
    },
  }
);

const ICONS = {
  danger: CircleAlertIcon,
  info: InfoIcon,
  success: CircleCheckIcon,
  warning: TriangleAlertIcon,
} as const;

type CalloutProps = VariantProps<typeof calloutVariants> & {
  actions?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  onDismiss?: () => void;
  title: ReactNode;
  role?: "alert" | "status";
};

/** Inline banner for warnings, failures, and confirmations. */
export const Callout = ({
  actions,
  children,
  icon,
  onDismiss,
  role = "status",
  title,
  tone,
}: CalloutProps) => {
  const Icon = ICONS[tone ?? "info"];
  return (
    <div className={calloutVariants({ tone })} role={role}>
      {icon ?? <Icon aria-hidden="true" className="mt-2xs size-4 shrink-0" />}
      <div className="flex min-w-0 flex-1 flex-col gap-xs">
        <p className="type-label text-text">{title}</p>
        {children ? (
          <div className="type-caption text-text-secondary">{children}</div>
        ) : null}
        {actions ? (
          <div className="mt-sm flex flex-wrap items-center gap-md">
            {actions}
          </div>
        ) : null}
      </div>
      {onDismiss ? (
        <IconButton
          className={cn("-mt-xs -mr-xs")}
          icon={<XIcon />}
          label="Dismiss"
          onClick={onDismiss}
          size="sm"
        />
      ) : null}
    </div>
  );
};
