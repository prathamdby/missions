"use client";

import type { TranscriptItem } from "@missions/protocol/missions";
import { useState } from "react";
import type { ComponentType, SVGProps } from "react";

import {
  ChevronDownIcon,
  ChevronRightIcon,
  FileTextIcon,
  FolderIcon,
  GlobeIcon,
  PenSquareIcon,
  SearchIcon,
  TerminalIcon,
  WandIcon,
} from "@/components/mission/icons";
import { useMission } from "@/components/mission/mission-context";
import { CodeBlock } from "@/components/ui/code-block";
import { Spinner } from "@/components/ui/spinner";
import { toolCategory } from "@/lib/mission/timeline";
import type { ToolCall } from "@/lib/mission/timeline";
import { cn } from "@/lib/utils";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

const TOOL_ICONS: Record<string, Icon> = {
  ApplyPatch: PenSquareIcon,
  Create: PenSquareIcon,
  Edit: PenSquareIcon,
  Execute: TerminalIcon,
  FetchUrl: GlobeIcon,
  Glob: SearchIcon,
  Grep: SearchIcon,
  LS: FolderIcon,
  MultiEdit: PenSquareIcon,
  Read: FileTextIcon,
  WebSearch: GlobeIcon,
};

const CATEGORY_ICONS: Record<string, Icon> = {
  edit: PenSquareIcon,
  explore: SearchIcon,
  other: WandIcon,
  run: TerminalIcon,
};

const VERBS: Record<string, string> = {
  ApplyPatch: "Patch",
  Execute: "Run",
  LS: "List",
  MultiEdit: "Edit",
  WebSearch: "Search",
};

/** Short tool output reads as a status ("2 of 10 failed"); longer output does not. */
const SHORT_OUTPUT = 32;

export const toolNameOf = (call: ToolCall) =>
  call.call?.toolName ?? call.result?.toolName ?? "Tool";

export const inputOf = (call: ToolCall): Record<string, unknown> => {
  const input = call.call?.toolInput;
  return input !== null && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
};

export const stringField = (
  input: Record<string, unknown>,
  ...keys: string[]
) => {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value) {
      return value;
    }
    if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
      return value.join(" ");
    }
  }
  return null;
};

export const relativeTo = (root: string | null, value: string) =>
  root && value.startsWith(`${root}/`) ? value.slice(root.length + 1) : value;

/** The mono argument in a Paper tool row: a path, pattern, or command. */
export const argumentOf = (call: ToolCall, root: string | null) => {
  const input = inputOf(call);
  const name = toolNameOf(call);
  const path = stringField(input, "file_path", "path", "directory_path");
  if (name === "Grep") {
    const pattern = stringField(input, "pattern") ?? "";
    return path ? `"${pattern}" in ${relativeTo(root, path)}` : `"${pattern}"`;
  }
  const value =
    stringField(
      input,
      "command",
      "file_path",
      "patterns",
      "pattern",
      "url",
      "query",
      "path",
      "directory_path"
    ) ??
    Object.values(input).find((entry) => typeof entry === "string") ??
    "";
  return relativeTo(root, String(value));
};

const countLines = (text: string) =>
  text.split("\n").filter((line) => line.trim() !== "").length;

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/** Right-aligned mono meta: line and match counts, or a short failure status. */
const metaOf = (call: ToolCall) => {
  const { result } = call;
  if (!result) {
    return null;
  }
  const name = toolNameOf(call);
  if (result.isError) {
    const last = result.text.trim().split("\n").at(-1)?.trim() ?? "";
    return {
      text: last && last.length <= SHORT_OUTPUT ? last : "failed",
      warning: true,
    };
  }
  const lines = countLines(result.text);
  const counts: Record<string, string> = {
    Glob: plural(lines, "file"),
    Grep: plural(lines, "match", "matches"),
    LS: plural(lines, "entry", "entries"),
    Read: plural(lines, "line"),
  };
  return counts[name] ? { text: counts[name], warning: false } : null;
};

const PHRASES: Record<string, [string, string, string?]> = {
  ApplyPatch: ["edited", "file"],
  Create: ["created", "file"],
  Edit: ["edited", "file"],
  Execute: ["ran", "command"],
  FetchUrl: ["fetched", "page"],
  Glob: ["ran", "search", "searches"],
  Grep: ["ran", "search", "searches"],
  LS: ["listed", "folder"],
  MultiEdit: ["edited", "file"],
  Read: ["read", "file"],
  WebSearch: ["searched the web", "time"],
};

/** "Read 4 files, ran 2 searches" in first-use order. */
export const toolSummary = (calls: readonly ToolCall[]) => {
  const counts = new Map<string, number>();
  for (const call of calls) {
    const name = toolNameOf(call);
    const phrase = PHRASES[name];
    const key = phrase ? `${phrase[0]}|${phrase[1]}|${phrase[2] ?? ""}` : name;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const text = [...counts.entries()]
    .map(([key, count]) => {
      const [verb, one, many] = key.split("|");
      if (one === undefined) {
        return count > 1 ? `used ${key} ×${count}` : `used ${key}`;
      }
      return `${verb} ${plural(count, one, many || `${one}s`)}`;
    })
    .join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const inputText = (item: TranscriptItem | null) => {
  if (item?.toolInput === undefined || item.toolInput === null) {
    return null;
  }
  return typeof item.toolInput === "string"
    ? item.toolInput
    : JSON.stringify(item.toolInput, null, 2);
};

const ToolRow = ({ call, running }: { call: ToolCall; running: boolean }) => {
  const { live } = useMission();
  const [open, setOpen] = useState(false);
  const name = toolNameOf(call);
  const RowIcon = TOOL_ICONS[name] ?? WandIcon;
  const meta = metaOf(call);
  const input = inputText(call.call);
  const failed = call.result?.isError === true;
  return (
    <li className="flex flex-col">
      <button
        aria-expanded={open}
        className="flex h-7 w-full min-w-0 cursor-pointer items-center gap-md rounded-xs text-left focus-visible:shadow-focus"
        onClick={() => setOpen(!open)}
        type="button"
      >
        <RowIcon
          aria-hidden="true"
          className="size-3.5 shrink-0 text-text-tertiary"
        />
        <span className="shrink-0 text-sm leading-sm font-medium tracking-tight text-text-secondary">
          {VERBS[name] ?? name}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs leading-sm font-book text-text-tertiary">
          {argumentOf(call, live.mission.workspace?.path ?? null)}
        </span>
        {meta ? (
          <span
            className={cn(
              "shrink-0 font-mono text-2xs leading-xs",
              meta.warning ? "text-warning" : "text-text-tertiary"
            )}
          >
            {meta.text}
          </span>
        ) : null}
        {running && call.result === null ? (
          <Spinner label="Running" pattern="wave" size="sm" />
        ) : null}
      </button>
      {open ? (
        <div className="flex flex-col gap-sm pt-xs pb-sm">
          {input ? <CodeBlock code={input} title="Input" /> : null}
          {call.result ? (
            <CodeBlock
              code={call.result.text || "(no output)"}
              title="Result"
              tone={failed ? "error" : "default"}
            />
          ) : null}
        </div>
      ) : null}
    </li>
  );
};

const GroupHeader = ({
  active,
  calls,
  icon: HeaderIcon,
  onToggle,
  open,
}: {
  active: boolean;
  calls: readonly ToolCall[];
  icon: Icon;
  onToggle: () => void;
  open: boolean;
}) => {
  const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
  return (
    <button
      aria-expanded={open}
      className="flex h-2xl w-fit max-w-full min-w-0 cursor-pointer items-center gap-md rounded-xs text-text-tertiary transition-colors duration-fast hover:text-text-secondary focus-visible:shadow-focus"
      onClick={onToggle}
      type="button"
    >
      {active ? (
        <Spinner label="Running tools" pattern="wave" size="sm" />
      ) : (
        <HeaderIcon aria-hidden="true" className="size-3.5 shrink-0" />
      )}
      <span className="min-w-0 truncate text-sm leading-sm font-book tracking-tight">
        {toolSummary(calls)}
      </span>
      <Chevron aria-hidden="true" className="size-3 shrink-0" />
    </button>
  );
};

/** The hairline under a 14px header icon that the rows hang from. */
export const IndentRule = () => (
  <span aria-hidden="true" className="flex w-3.5 shrink-0 justify-center">
    <span className="w-px bg-border" />
  </span>
);

const groupIcon = (calls: readonly ToolCall[]) =>
  CATEGORY_ICONS[
    toolCategory(calls[0]?.call?.toolName ?? calls[0]?.result?.toolName ?? null)
  ] ?? WandIcon;

/**
 * Paper tool run: each group is a summary line over a hairline-indented list
 * of calls. Collapsed, consecutive groups fold into one summary line.
 */
export const ToolRun = ({
  autoOpen,
  groups,
  running,
}: {
  /** Open while the run is the live tail of the transcript. */
  autoOpen: boolean;
  groups: readonly (readonly ToolCall[])[];
  running: boolean;
}) => {
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? autoOpen;
  const toggle = () => setOverride(!open);
  const all = groups.flat();
  const active = running && all.some((call) => call.result === null);
  if (!open) {
    return (
      <div className="flex flex-col gap-2xs">
        <GroupHeader
          active={active}
          calls={all}
          icon={groupIcon(all)}
          onToggle={toggle}
          open={false}
        />
      </div>
    );
  }
  return groups.map((calls) => (
    <div className="flex flex-col gap-2xs" key={calls[0]?.id}>
      <GroupHeader
        active={running && calls.some((call) => call.result === null)}
        calls={calls}
        icon={groupIcon(calls)}
        onToggle={toggle}
        open
      />
      <div className="flex">
        <IndentRule />
        <ul className="flex min-w-0 flex-1 flex-col pl-control">
          {calls.map((call) => (
            <ToolRow call={call} key={call.id} running={running} />
          ))}
        </ul>
      </div>
    </div>
  ));
};
