import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";

import { CopyButton } from "@/components/ui/copy-button";
import { cn } from "@/lib/utils";

const preVariants = cva(
  "overflow-auto px-lg py-md font-mono text-xs leading-md text-syntax-text",
  {
    defaultVariants: { height: "md", wrap: false },
    variants: {
      height: {
        auto: "",
        md: "max-h-80",
        sm: "max-h-48",
      },
      wrap: {
        false: "whitespace-pre",
        true: "break-words whitespace-pre-wrap",
      },
    },
  }
);

type CodeBlockProps = VariantProps<typeof preVariants> & {
  code: string;
  copy?: boolean;
  meta?: ReactNode;
  title?: ReactNode;
  tone?: "default" | "error";
};

export const CodeBlock = ({
  code,
  copy = true,
  height,
  meta,
  title,
  tone = "default",
  wrap,
}: CodeBlockProps) => (
  <div className="group/code relative min-w-0 overflow-hidden rounded-md bg-bg shadow-[inset_0_0_0_1px_var(--color-border)]">
    {title || meta ? (
      <div className="flex h-9 items-center gap-md border-b border-border-subtle pr-sm pl-lg">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-secondary">
          {title}
        </span>
        {meta}
        {copy ? <CopyButton value={code} /> : null}
      </div>
    ) : null}
    <pre
      className={cn(
        preVariants({ height, wrap }),
        tone === "error" ? "text-terminal-red" : ""
      )}
    >
      <code>{code}</code>
    </pre>
    {copy && !(title || meta) ? (
      <div className="absolute top-xs right-xs opacity-0 transition-opacity duration-fast group-focus-within/code:opacity-100 group-hover/code:opacity-100">
        <CopyButton value={code} />
      </div>
    ) : null}
  </div>
);

/** Raw command output on the page background (NZJ, OBV). */
export const TerminalLog = ({ className, ...props }: ComponentProps<"div">) => (
  <div
    className={cn(
      "flex min-w-0 flex-col gap-2xs overflow-x-auto rounded-sm bg-bg px-lg py-control shadow-[inset_0_0_0_1px_var(--color-border-subtle)]",
      className
    )}
    {...props}
  />
);

const terminalLineTone = {
  current: "text-text-secondary",
  danger: "text-danger",
  muted: "text-text-tertiary",
} as const;

export const TerminalLine = ({
  className,
  tone = "muted",
  ...props
}: ComponentProps<"p"> & { tone?: keyof typeof terminalLineTone }) => (
  <p
    className={cn(
      // No weight class here: tailwind-merge reads `font-book` as a family and would drop `font-mono`.
      "min-h-5 font-mono text-2xs leading-sm whitespace-pre",
      terminalLineTone[tone],
      className
    )}
    {...props}
  />
);

/** The command a dialog is about to run, previewed in a quiet inset box (ONT). */
export const CommandPreview = ({
  className,
  command,
  icon,
}: {
  className?: string;
  command: string;
  icon?: ReactNode;
}) => (
  <div
    className={cn(
      "flex min-w-0 items-center gap-sm rounded-sm bg-bg px-lg py-control text-text-tertiary shadow-[inset_0_0_0_1px_var(--color-border-subtle)]",
      className
    )}
  >
    {icon}
    <span className="min-w-0 truncate font-mono text-2xs leading-xs font-book">
      {command}
    </span>
  </div>
);

/** A shell prompt with one command and a copy button (NNV). */
export const CommandField = ({
  className,
  command,
}: {
  className?: string;
  command: string;
}) => (
  <div
    className={cn(
      "flex h-10 w-90 max-w-full shrink-0 items-center gap-control rounded-sm bg-bg pr-md pl-card shadow-[inset_0_0_0_1px_var(--color-border)]",
      className
    )}
  >
    <span
      aria-hidden="true"
      className="font-mono text-xs leading-sm font-book text-text-tertiary"
    >
      $
    </span>
    <code className="min-w-0 flex-1 truncate text-left font-mono text-xs leading-sm text-text">
      {command}
    </code>
    <CopyButton label={`Copy ${command}`} size="md" value={command} />
  </div>
);

export const InlineCode = ({ className, ...props }: ComponentProps<"code">) => (
  <code
    className={cn(
      "rounded-xs bg-surface-overlay px-xs py-2xs font-mono text-xs text-syntax-text",
      className
    )}
    {...props}
  />
);
