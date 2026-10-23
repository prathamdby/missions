import type { DiffHunk, DiffLine } from "@missions/protocol/files";

import { cn } from "@/lib/utils";

const ROW_TONE: Record<DiffLine["kind"], string> = {
  add: "bg-diff-add",
  context: "",
  del: "bg-diff-del",
};

const GUTTER_TONE: Record<DiffLine["kind"], string> = {
  add: "bg-diff-add-gutter text-text-secondary",
  context: "text-diff-line-number",
  del: "bg-diff-del-gutter text-text-secondary",
};

const SIGN: Record<DiffLine["kind"], string> = {
  add: "+",
  context: " ",
  del: "-",
};

const DiffRow = ({ line }: { line: DiffLine }) => (
  <div className={cn("flex min-w-max", ROW_TONE[line.kind])}>
    <span
      className={cn(
        "w-10 shrink-0 px-sm text-right select-none",
        GUTTER_TONE[line.kind]
      )}
    >
      {line.kind === "add"
        ? line.newNumber
        : (line.oldNumber ?? line.newNumber)}
    </span>
    <span className="w-4 shrink-0 text-center text-text-tertiary select-none">
      {SIGN[line.kind]}
    </span>
    <span className="pr-lg whitespace-pre">{line.text}</span>
  </div>
);

/** Renders protocol diff hunks with add/delete gutters. */
export const DiffView = ({
  hunks,
  maxHeight = "md",
}: {
  hunks: DiffHunk[];
  maxHeight?: "auto" | "md";
}) => (
  <div
    className={cn(
      "overflow-auto rounded-md bg-bg py-xs font-mono text-xs leading-md text-syntax-text shadow-[inset_0_0_0_1px_var(--color-border)]",
      maxHeight === "md" ? "max-h-80" : ""
    )}
  >
    {hunks.map((hunk, hunkIndex) => (
      <div key={`${hunk.header}-${String(hunkIndex)}`}>
        {hunk.header ? (
          <div className="px-lg py-xs text-text-tertiary">{hunk.header}</div>
        ) : null}
        {hunk.lines.map((line, lineIndex) => (
          <DiffRow
            key={`${String(line.oldNumber)}-${String(line.newNumber)}-${String(lineIndex)}`}
            line={line}
          />
        ))}
      </div>
    ))}
  </div>
);
