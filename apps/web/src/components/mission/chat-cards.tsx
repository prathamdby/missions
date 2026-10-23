"use client";

import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import type { BadgeTone } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Paper chat card: raised surface, layered shadow, optional tinted ring. */
export const ChatCard = ({
  children,
  label,
  testId,
  tone = "neutral",
}: {
  children: ReactNode;
  label: string;
  testId?: string;
  tone?: "danger" | "neutral" | "warning";
}) => (
  <section
    aria-label={label}
    className={cn(
      "flex flex-col overflow-hidden rounded-md bg-surface-raised shadow-sm",
      tone === "warning" && "ring-1 ring-warning/25",
      tone === "danger" && "ring-1 ring-danger/25"
    )}
    data-testid={testId}
  >
    {children}
  </section>
);

export const ChatCardHeader = ({
  children,
  divided = true,
  gap = "control",
  icon,
  meta,
  note,
  status,
}: {
  children: ReactNode;
  divided?: boolean;
  gap?: "control" | "md";
  icon?: ReactNode;
  /** Mono detail before the status, such as a path or revision. */
  meta?: ReactNode;
  /** Quiet caption on the right, such as "Saved to plans/plan.md". */
  note?: ReactNode;
  status?: { label: string; tone: BadgeTone } | null;
}) => (
  <header
    className={cn(
      "flex h-10 shrink-0 items-center px-card",
      gap === "control" ? "gap-control" : "gap-md",
      divided && "border-b border-border-subtle"
    )}
  >
    {icon}
    <h3 className="min-w-0 flex-1 truncate text-sm leading-sm font-medium tracking-tight text-text">
      {children}
    </h3>
    {meta ? (
      <span className="shrink-0 font-mono text-2xs leading-xs text-text-tertiary">
        {meta}
      </span>
    ) : null}
    {note ? (
      <span className="shrink-0 text-xs leading-sm font-book tracking-tight text-text-tertiary">
        {note}
      </span>
    ) : null}
    {status ? (
      <Badge dot tone={status.tone}>
        {status.label}
      </Badge>
    ) : null}
  </header>
);

export const ChatCardBody = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-col gap-lg p-card">{children}</div>
);

export const ChatCardFooter = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-wrap items-center gap-md border-t border-border-subtle px-card py-control">
    {children}
  </div>
);

/** Centered rule with an event line, as in Paper TBH and TYS. */
export const EventLine = ({
  children,
  icon,
}: {
  children: ReactNode;
  icon: ReactNode;
}) => (
  <div className="flex items-center gap-lg text-text-tertiary [&_svg]:size-3.5">
    <span className="h-px flex-1 bg-border-subtle" />
    {icon}
    <span className="max-w-prose truncate text-xs leading-sm font-book tracking-tight">
      {children}
    </span>
    <span className="h-px flex-1 bg-border-subtle" />
  </div>
);

/** Paper checkbox: 16px, inset strong hairline, accent when checked. */
export const CheckboxRow = ({
  checked,
  children,
  disabled,
  onChange,
  testId,
}: {
  checked: boolean;
  children: ReactNode;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  testId?: string;
}) => (
  <label className="flex cursor-pointer items-center gap-control text-sm leading-sm font-book tracking-tight text-text has-disabled:cursor-not-allowed has-disabled:text-text-disabled">
    <input
      checked={checked}
      className="size-4 shrink-0 cursor-pointer appearance-none rounded-xs bg-surface-raised ring-1 ring-border-strong ring-inset checked:bg-accent checked:ring-accent focus-visible:shadow-focus disabled:cursor-not-allowed"
      data-testid={testId}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
      type="checkbox"
    />
    {children}
  </label>
);
