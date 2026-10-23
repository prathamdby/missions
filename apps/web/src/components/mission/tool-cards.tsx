"use client";

import { ChatCard } from "@/components/mission/chat-cards";
import { PenSquareIcon, TerminalIcon } from "@/components/mission/icons";
import { useMission } from "@/components/mission/mission-context";
import { DotLoader } from "@/components/mission/panel-kit";
import {
  argumentOf,
  inputOf,
  relativeTo,
  stringField,
  toolNameOf,
} from "@/components/mission/tool-group";
import type { ToolCall } from "@/lib/mission/timeline";
import {
  DIFF_LINES,
  editDiff,
  exitCodeOf,
  lineTone,
  outputTail,
  passedCount,
  runTime,
} from "@/lib/mission/tool-output";
import type { DiffLine, LineTone } from "@/lib/mission/tool-output";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

const TONES: Record<LineTone, string> = {
  danger: "text-danger",
  secondary: "text-text-secondary",
  success: "text-success",
  warning: "text-warning",
};

const EDIT_TOOLS = new Set(["Create", "Edit", "MultiEdit"]);

/** A lone command that failed or is still running reads as a card (Paper I9X). */
export const isCommandCard = (calls: readonly ToolCall[], running: boolean) => {
  const [only] = calls;
  if (calls.length !== 1 || !only || toolNameOf(only) !== "Execute") {
    return false;
  }
  return only.result === null ? running : only.result.isError;
};

/** A lone command that succeeded reads as one "Ran" row (Paper I9X). */
export const isRanRow = (calls: readonly ToolCall[]) => {
  const [only] = calls;
  return (
    calls.length === 1 &&
    only !== undefined &&
    toolNameOf(only) === "Execute" &&
    only.result !== null &&
    !only.result.isError
  );
};

/** Edits with their input render as diff cards (Paper I9X). */
export const isEditGroup = (calls: readonly ToolCall[]) =>
  calls.length > 0 &&
  calls.every(
    (call) =>
      EDIT_TOOLS.has(toolNameOf(call)) &&
      editDiff(toolNameOf(call), inputOf(call)).length > 0
  );

const elapsedOf = (call: ToolCall, now: number) => {
  const start = Date.parse(
    call.call?.createdAt ?? call.result?.createdAt ?? ""
  );
  const end = call.result ? Date.parse(call.result.createdAt) : now;
  return Number.isNaN(start) ? 0 : end - start;
};

const STOP_UNSUPPORTED =
  "Stopping a single command is not supported. Pause the mission to stop every agent.";

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
            <button
              aria-disabled="true"
              className="cursor-not-allowed text-xs leading-sm font-medium tracking-tight text-text-tertiary"
              title={STOP_UNSUPPORTED}
              type="button"
            >
              Stop
            </button>
          </span>
        )}
      </header>
      {lines.length > 0 ? (
        <div className="flex flex-col overflow-x-auto bg-surface px-lg py-control">
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

const ROW_TONES: Record<DiffLine["kind"], string> = {
  add: "bg-diff-add",
  del: "bg-diff-del",
};

const GUTTER_TONES: Record<DiffLine["kind"], string> = {
  add: "border-l-2 border-success bg-diff-add-gutter text-success",
  del: "border-l-2 border-danger bg-diff-del-gutter text-danger",
};

export const EditCard = ({ call }: { call: ToolCall }) => {
  const { live } = useMission();
  const name = toolNameOf(call);
  const diff = editDiff(name, inputOf(call));
  const path = relativeTo(
    live.mission.workspace?.path ?? null,
    stringField(inputOf(call), "file_path", "path") ?? "file"
  );
  const added = diff.filter((line) => line.kind === "add").length;
  const removed = diff.length - added;
  const shown = diff.slice(0, DIFF_LINES);
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
      <div className="flex flex-col overflow-x-auto bg-surface py-xs">
        {shown.map((line, index) => (
          <div
            className={cn(
              "flex h-5 shrink-0 items-center",
              ROW_TONES[line.kind]
            )}
            // Diff lines can repeat; their order is their identity.
            // oxlint-disable-next-line no-array-index-key
            key={index}
          >
            <span
              className={cn(
                "flex h-5 w-9.5 shrink-0 items-center justify-end pr-md font-mono text-2xs leading-lg select-none",
                GUTTER_TONES[line.kind]
              )}
            >
              {line.kind === "add" ? "+" : "−"}
            </span>
            <span className="pl-lg font-mono text-2xs leading-lg whitespace-pre text-syntax-text">
              {line.text}
            </span>
          </div>
        ))}
        {diff.length > shown.length ? (
          <span className="pt-xs pl-lg font-mono text-2xs leading-lg text-text-tertiary">
            {diff.length - shown.length} more lines
          </span>
        ) : null}
      </div>
    </ChatCard>
  );
};
