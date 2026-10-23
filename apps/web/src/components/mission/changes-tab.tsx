"use client";

import type { DiffHunk, DiffLine, FileDiff } from "@missions/protocol/files";
import { useState } from "react";

import {
  ChevronDownIcon,
  ChevronsUpDownIcon,
} from "@/components/mission/icons";
import { useMission } from "@/components/mission/mission-context";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api/api-error";
import { useChanges } from "@/lib/api/queries";
import { hunkGaps, splitPath } from "@/lib/mission/changes";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Partial<Record<FileDiff["status"], string>> = {
  added: "New",
  deleted: "Deleted",
  renamed: "Renamed",
  untracked: "New",
};

const ROW: Record<DiffLine["kind"], string> = {
  add: "bg-diff-add",
  context: "",
  del: "bg-diff-del",
};

const GUTTER: Record<DiffLine["kind"], string> = {
  add: "border-l-2 border-success bg-diff-add-gutter text-success",
  context: "text-diff-line-number",
  del: "border-l-2 border-danger bg-diff-del-gutter text-danger",
};

const Line = ({ line }: { line: DiffLine }) => (
  <div
    className={cn("flex h-5 min-w-max shrink-0 items-center", ROW[line.kind])}
  >
    <span
      className={cn(
        "flex h-5 w-9.5 shrink-0 items-center justify-end pr-md font-mono text-2xs leading-lg select-none",
        GUTTER[line.kind]
      )}
    >
      {line.kind === "del"
        ? line.oldNumber
        : (line.newNumber ?? line.oldNumber)}
    </span>
    <span className="sr-only">
      {line.kind === "add" ? "Added: " : ""}
      {line.kind === "del" ? "Removed: " : ""}
    </span>
    <span className="pr-lg pl-lg font-mono text-2xs leading-lg whitespace-pre text-syntax-text">
      {line.text}
    </span>
  </div>
);

const Gap = ({ lines }: { lines: number }) => (
  <div className="flex h-6 shrink-0 items-center gap-md bg-surface-raised pl-lg">
    <ChevronsUpDownIcon className="size-3 text-text-tertiary" />
    <span className="text-2xs leading-xs tracking-tight text-text-tertiary">
      {lines} unmodified line{lines === 1 ? "" : "s"}
    </span>
  </div>
);

const Hunks = ({ hunks }: { hunks: DiffHunk[] }) => {
  const gaps = hunkGaps(hunks);
  return (
    <div className="flex flex-col overflow-x-auto pb-xs">
      {hunks.map((hunk, index) => (
        <div className="flex flex-col" key={`${hunk.header}-${String(index)}`}>
          {gaps[index] ? <Gap lines={gaps[index]} /> : null}
          {hunk.lines.map((line, lineIndex) => (
            <Line
              key={`${String(line.oldNumber)}-${String(line.newNumber)}-${String(lineIndex)}`}
              line={line}
            />
          ))}
        </div>
      ))}
    </div>
  );
};

const FileCard = ({
  defaultOpen,
  file,
}: {
  defaultOpen: boolean;
  file: FileDiff;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const { dir, name } = splitPath(file.path);
  const label = STATUS_LABEL[file.status];
  const canExpand = !file.binary && file.hunks.length > 0;
  return (
    <li className="flex flex-col overflow-hidden rounded-md bg-surface shadow-sm">
      <button
        aria-expanded={canExpand ? open : undefined}
        className={cn(
          "flex h-9 shrink-0 cursor-pointer items-center gap-md px-control text-left",
          open && canExpand && "border-b border-border-subtle"
        )}
        disabled={!canExpand}
        onClick={() => setOpen(!open)}
        type="button"
      >
        <ChevronDownIcon
          className={cn(
            "size-3 text-text-tertiary transition-transform duration-fast",
            open && canExpand ? "" : "-rotate-90"
          )}
        />
        <span className="flex min-w-0 flex-1 items-baseline">
          <span className="truncate text-xs leading-sm tracking-tight text-text-tertiary">
            {dir}
          </span>
          <span className="shrink-0 text-xs leading-sm font-medium tracking-tight text-text">
            {name}
          </span>
        </span>
        {file.preExisting && !file.committed ? (
          <span className="text-2xs leading-xs text-warning">
            Before mission
          </span>
        ) : null}
        {file.committed ? (
          <span className="text-2xs leading-xs text-text-tertiary">
            Committed
          </span>
        ) : null}
        {label ? (
          <span className="text-2xs leading-xs text-text-tertiary">
            {label}
          </span>
        ) : null}
        {file.binary ? (
          <span className="text-2xs leading-xs text-text-tertiary">Binary</span>
        ) : null}
        <span className="flex gap-sm font-mono text-2xs leading-xs">
          {file.additions > 0 ? (
            <span className="text-success">+{file.additions}</span>
          ) : null}
          {file.deletions > 0 ? (
            <span className="text-danger">−{file.deletions}</span>
          ) : null}
        </span>
      </button>
      {open && canExpand ? (
        <>
          <Hunks hunks={file.hunks} />
          {file.truncated ? (
            <p className="px-lg pb-sm text-2xs leading-xs text-text-tertiary">
              Diff cut at the line budget. Open the file to see the rest.
            </p>
          ) : null}
        </>
      ) : null}
    </li>
  );
};

const OPEN_FILES = 2;

/** Paper HJD: totals, then one collapsible diff card per file. */
export const ChangesTab = () => {
  const { live, missionId } = useMission();
  const changes = useChanges(missionId, live.workspaceSeq);
  if (changes.isPending) {
    return (
      <div className="flex flex-col gap-md">
        <Skeleton className="w-1/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (changes.isError) {
    return (
      <p className="text-xs leading-sm text-danger" role="alert">
        Could not load changes. {errorMessage(changes.error)}
      </p>
    );
  }
  const { files, totals } = changes.data;
  if (files.length === 0) {
    return (
      <p className="text-xs leading-sm text-text-tertiary">
        No changes yet. Diffs appear here as agents edit the workspace.
      </p>
    );
  }
  return (
    <>
      <div className="flex h-7 shrink-0 items-center gap-control">
        <h2 className="text-sm leading-sm font-semibold tracking-tight text-text">
          {totals.files} file{totals.files === 1 ? "" : "s"}
        </h2>
        <span className="flex gap-sm font-mono text-2xs leading-xs">
          <span className="text-success">+{totals.additions}</span>
          <span className="text-danger">−{totals.deletions}</span>
        </span>
      </div>
      <ul
        aria-label="Changed files"
        className="flex flex-col gap-lg"
        data-testid="changes-list"
      >
        {files.map((file, index) => (
          <FileCard
            defaultOpen={index < OPEN_FILES}
            file={file}
            key={file.path}
          />
        ))}
      </ul>
    </>
  );
};
