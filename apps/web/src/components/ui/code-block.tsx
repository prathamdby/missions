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

export const InlineCode = ({ className, ...props }: ComponentProps<"code">) => (
  <code
    className={cn(
      "rounded-xs bg-surface-overlay px-xs py-2xs font-mono text-xs text-syntax-text",
      className
    )}
    {...props}
  />
);
