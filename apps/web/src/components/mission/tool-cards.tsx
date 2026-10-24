"use client";

import { useMemo } from "react";

import { ChatCard } from "@/components/mission/chat-cards";
import { PenSquareIcon, TerminalIcon } from "@/components/mission/icons";
import { useMission } from "@/components/mission/mission-context";
import { DotLoader } from "@/components/mission/panel-kit";
import { useDiffHighlight } from "@/components/mission/use-diff-highlight";
import { UnavailableButton } from "@/components/ui/button";
import { DiffRow } from "@/components/ui/diff-row";
import { ScrollArea } from "@/components/ui/scroll-area";
import { HighlightedLine } from "@/components/ui/syntax-highlight";
import { languageForPath } from "@/lib/code-language";
import type { ToolCall } from "@/lib/mission/timeline";
import {
  argumentOf,
  elapsedOf,
  inputOf,
  relativeTo,
  stringField,
  toolNameOf,
  DIFF_LINES,
  editDiff,
  exitCodeOf,
  lineTone,
  outputTail,
  passedCount,
  runTime,
} from "@/lib/mission/tool-output";
import type { LineTone } from "@/lib/mission/tool-output";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

const TONES: Record<LineTone, string> = {
  danger: "text-danger",
  secondary: "text-text-secondary",
  success: "text-success",
  warning: "text-warning",
};

export const CommandCard = ({ call }: { call: ToolCall }) => {
  const { live } = useMission();
  const now = useNow();
  const command = argumentOf(call, live.mission.workspace?.path ?? null);
  const { result } = call;
  const lines = result ? outputTail(result.text) : [];
  const code = result ? exitCodeOf(result.text) : null;
  return (
    <ChatCard label={`Command: ${command}`}>
      <header className="flex h-9 shrink-0 items-center gap-control border-b border-border-subtle px-lg">
        <TerminalIcon
          aria-hidden="true"
          className="size-3.5 shrink-0 text-text-tertiary"
        />
        <span className="min-w-0 flex-1 truncate font-mono text-xs leading-sm text-text">
          {command}
        </span>
        {result ? (
          <span className="flex shrink-0 items-center gap-md">
            <span className="font-mono text-2xs leading-xs text-text-tertiary">
              {runTime(elapsedOf(call, now))}
            </span>
            <span className="text-xs leading-sm font-medium tracking-tight text-danger">
              {code === null ? "Failed" : `Exit ${code}`}
            </span>
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-md">
            <DotLoader label="Running" />
            <span className="font-mono text-2xs leading-xs text-text-secondary">
              Running · {runTime(elapsedOf(call, now))}
            </span>
            <UnavailableButton
              reason="Pause to stop"
              size="text"
              variant="link"
            >
              Stop
            </UnavailableButton>
          </span>
        )}
      </header>
      {lines.length > 0 ? (
        <ScrollArea asChild axis="x">
          <div className="flex flex-col bg-surface px-lg py-control select-text">
            {lines.map((line, index) => (
              <span
                className={cn(
                  "font-mono text-2xs leading-md whitespace-pre",
                  TONES[lineTone(line)]
                )}
                // Output lines can repeat; their order is their identity.
                // oxlint-disable-next-line no-array-index-key
                key={index}
              >
                {line}
              </span>
            ))}
          </div>
        </ScrollArea>
      ) : null}
    </ChatCard>
  );
};

export const RanRow = ({ call }: { call: ToolCall }) => {
  const { live } = useMission();
  const now = useNow();
  const passed = call.result ? passedCount(call.result.text) : null;
  const meta = [passed, runTime(elapsedOf(call, now))]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex h-7 min-w-0 items-center gap-md">
      <TerminalIcon
        aria-hidden="true"
        className="size-3.5 shrink-0 text-text-tertiary"
      />
      <span className="shrink-0 text-sm leading-sm font-medium tracking-tight text-text-secondary">
        Ran
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-xs leading-sm text-text-tertiary">
        {argumentOf(call, live.mission.workspace?.path ?? null)}
      </span>
      <span
        className={cn(
          "shrink-0 font-mono text-2xs leading-xs",
          passed ? "text-success" : "text-text-tertiary"
        )}
      >
        {meta}
      </span>
    </div>
  );
};

export const EditCard = ({ call }: { call: ToolCall }) => {
  const { live } = useMission();
  const name = toolNameOf(call);
  const input = inputOf(call);
  const diff = useMemo(() => editDiff(name, input), [name, input]);
  const filePath = stringField(input, "file_path", "path");
  const path = relativeTo(
    live.mission.workspace?.path ?? null,
    filePath ?? "file"
  );
  const added = diff.filter((line) => line.kind === "add").length;
  const removed = diff.length - added;
  const shown = useMemo(() => diff.slice(0, DIFF_LINES), [diff]);
  const hunks = useMemo(() => [{ lines: shown }], [shown]);
  const tokens = useDiffHighlight(
    hunks,
    filePath ? languageForPath(filePath) : null
  )?.[0];
  return (
    <ChatCard label={`Edited ${path}`}>
      <header className="flex h-9 shrink-0 items-center gap-control border-b border-border-subtle px-lg">
        <PenSquareIcon
          aria-hidden="true"
          className="size-3.5 shrink-0 text-text-tertiary"
        />
        <span className="shrink-0 text-sm leading-sm font-medium tracking-tight text-text-secondary">
          {name === "Create" ? "Created" : "Edited"}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs leading-sm text-text">
          {path}
        </span>
        <span className="flex shrink-0 gap-sm font-mono text-2xs leading-xs">
          {added > 0 ? <span className="text-success">+{added}</span> : null}
          {removed > 0 ? <span className="text-danger">−{removed}</span> : null}
        </span>
      </header>
      <ScrollArea asChild axis="x">
        <div className="flex flex-col bg-surface py-xs">
          {shown.map((line, index) => (
            <DiffRow
              kind={line.kind}
              // Diff lines can repeat; their order is their identity.
              // oxlint-disable-next-line no-array-index-key
              key={index}
              variant="tool"
            >
              <HighlightedLine text={line.text} tokens={tokens?.[index]} />
            </DiffRow>
          ))}
          {diff.length > shown.length ? (
            <span className="pt-xs pl-lg font-mono text-2xs leading-lg text-text-tertiary">
              {diff.length - shown.length} more lines
            </span>
          ) : null}
        </div>
      </ScrollArea>
    </ChatCard>
  );
};
