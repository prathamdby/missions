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
import { AlertIcon, CloseIcon } from "@/components/ui/icons";
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

/** PZ7: a flat tinted panel, used above the composer. */
const filledTone = {
  danger: "bg-danger-muted",
  info: "bg-info-muted",
  success: "bg-success-muted",
  warning: "bg-warning-muted",
} as const;

const ICONS = {
  danger: CircleAlertIcon,
  info: InfoIcon,
  success: CircleCheckIcon,
  warning: TriangleAlertIcon,
} as const;

type CalloutProps = VariantProps<typeof calloutVariants> & {
  actions?: ReactNode;
  /**
   * `card` sits on the page with a tinted ring; `filled` is a flat tinted
   * panel (PZ7); `strip` is a one-line tinted bar inside a dialog (OBV).
   */
  appearance?: "card" | "filled" | "strip";
  children?: ReactNode;
  icon?: ReactNode;
  onDismiss?: () => void;
  title: ReactNode;
  role?: "alert" | "status";
};

const CalloutStrip = ({
  actions,
  icon,
  role,
  title,
  tone,
}: {
  actions?: ReactNode;
  icon?: ReactNode;
  role: "alert" | "status";
  title: ReactNode;
  tone: keyof typeof filledTone;
}) => (
  <div
    className={cn(
      "flex w-full min-w-0 items-center gap-control rounded-sm px-lg py-control text-left",
      filledTone[tone]
    )}
    role={role}
  >
    {icon ?? <AlertIcon tone={tone === "info" ? "secondary" : tone} />}
    <p className="min-w-0 flex-1 text-sm leading-sm font-medium tracking-tight text-text">
      {title}
    </p>
    {actions}
  </div>
);

/** Inline banner for warnings, failures, and confirmations. */
export const Callout = ({
  actions,
  appearance = "card",
  children,
  icon,
  onDismiss,
  role = "status",
  title,
  tone,
}: CalloutProps) => {
  const Icon = ICONS[tone ?? "info"];
  if (appearance === "strip") {
    return (
      <CalloutStrip
        actions={actions}
        icon={icon}
        role={role}
        title={title}
        tone={tone ?? "info"}
      />
    );
  }
  if (appearance === "filled") {
    return (
      <div
        className={cn(
          "flex w-full min-w-0 items-start gap-lg rounded-md py-lg pr-lg pl-card text-left",
          filledTone[tone ?? "info"]
        )}
        role={role}
      >
        <span className="pt-2xs">
          {icon ?? (
            <AlertIcon tone={tone === "info" || !tone ? "secondary" : tone} />
          )}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-xs">
          <p className="text-sm leading-sm font-medium tracking-tight text-text">
            {title}
          </p>
          {children ? (
            <div className="text-xs leading-md tracking-tight text-text-secondary select-text">
              {children}
            </div>
          ) : null}
          {actions ? (
            <div className="flex flex-wrap items-center gap-md pt-sm">
              {actions}
            </div>
          ) : null}
        </div>
        {onDismiss ? (
          <button
            aria-label="Dismiss"
            className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-xs text-text-tertiary hover:text-text focus-visible:shadow-focus"
            onClick={onDismiss}
            type="button"
          >
            <CloseIcon size="sm" />
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <div className={calloutVariants({ tone })} role={role}>
      {icon ?? <Icon aria-hidden="true" className="mt-2xs size-4 shrink-0" />}
      <div className="flex min-w-0 flex-1 flex-col gap-xs">
        <p className="type-label text-text">{title}</p>
        {children ? (
          <div className="type-caption text-text-secondary select-text">
            {children}
          </div>
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
