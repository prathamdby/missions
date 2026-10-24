import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type DiffKind = "add" | "context" | "del";

const ROW: Record<DiffKind, string> = {
  add: "bg-diff-add",
  context: "",
  del: "bg-diff-del",
};

const GUTTER: Record<DiffKind, string> = {
  add: "border-l-2 border-success bg-diff-add-gutter text-success",
  context: "text-diff-line-number",
  del: "border-l-2 border-danger bg-diff-del-gutter text-danger",
};

const SIGN = { add: "+", del: "−" } as const;

type DiffRowProps = { children?: ReactNode } & (
  | { variant: "file"; kind: DiffKind; lineNumber: number | null }
  | { variant: "tool"; kind: Exclude<DiffKind, "context">; lineNumber?: never }
);

/** Shared Paper row chrome, with numbered file rows or signed tool rows. */
export const DiffRow = (props: DiffRowProps) => (
  <div
    className={cn(
      "flex h-5 shrink-0 items-center",
      props.variant === "file" && "min-w-max",
      ROW[props.kind]
    )}
  >
    <span
      className={cn(
        "flex h-5 w-9.5 shrink-0 items-center justify-end pr-md font-mono text-2xs leading-lg select-none",
        GUTTER[props.kind]
      )}
    >
      {props.variant === "file" ? props.lineNumber : SIGN[props.kind]}
    </span>
    {props.variant === "file" ? (
      <span className="sr-only">
        {props.kind === "add" ? "Added: " : ""}
        {props.kind === "del" ? "Removed: " : ""}
      </span>
    ) : null}
    <span
      className={cn(
        "pl-lg font-mono text-2xs leading-lg whitespace-pre text-syntax-text select-text",
        props.variant === "file" && "pr-lg"
      )}
    >
      {props.children}
    </span>
  </div>
);
