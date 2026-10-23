import type { AgentStatus } from "@missions/protocol/missions";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";

import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const avatarVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-full bg-surface-active font-medium text-text-secondary uppercase select-none",
  {
    defaultVariants: { size: "md" },
    variants: {
      size: {
        md: "size-7 text-2xs",
        sm: "size-5 text-2xs",
      },
    },
  }
);

const initialsOf = (name: string) =>
  name
    .split(/[\s/._-]+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");

export const Avatar = ({
  className,
  name,
  size,
}: VariantProps<typeof avatarVariants> & {
  className?: string;
  name: string;
}) => (
  <span aria-hidden="true" className={cn(avatarVariants({ size }), className)}>
    {initialsOf(name)}
  </span>
);

const DOT_TONE: Record<AgentStatus, string> = {
  failed: "bg-danger",
  idle: "bg-text-tertiary",
  interrupted: "bg-warning",
  starting: "bg-accent",
  stopped: "bg-text-disabled",
  stopping: "bg-text-secondary",
  waiting_answer: "bg-warning",
  waiting_permission: "bg-warning",
  working: "bg-accent",
};

/** Agent status mark: the pixel loader while working, a dot otherwise. */
export const AgentDot = ({ status }: { status: AgentStatus }) =>
  status === "working" ? (
    <Spinner label="Working" size="sm" />
  ) : (
    <span
      aria-hidden="true"
      className={cn("size-1.5 shrink-0 rounded-full", DOT_TONE[status])}
    />
  );
