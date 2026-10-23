"use client";

import type { TranscriptItem } from "@missions/protocol/missions";
import {
  CircleAlertIcon,
  FileTextIcon,
  FolderIcon,
  GlobeIcon,
  PencilIcon,
  SearchIcon,
  SquareTerminalIcon,
  WrenchIcon,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";

import { CodeBlock } from "@/components/ui/code-block";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleRow,
} from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import type { ToolCall } from "@/lib/mission/timeline";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

const TOOL_ICONS: Record<string, Icon> = {
  ApplyPatch: PencilIcon,
  Create: PencilIcon,
  Edit: PencilIcon,
  Execute: SquareTerminalIcon,
  FetchUrl: GlobeIcon,
  Glob: SearchIcon,
  Grep: SearchIcon,
  LS: FolderIcon,
  MultiEdit: PencilIcon,
  Read: FileTextIcon,
  WebSearch: GlobeIcon,
};

const toolNameOf = (call: ToolCall) =>
  call.call?.toolName ?? call.result?.toolName ?? "Tool";

const inputText = (item: TranscriptItem | null) => {
  if (item?.toolInput === undefined || item.toolInput === null) {
    return null;
  }
  return typeof item.toolInput === "string"
    ? item.toolInput
    : JSON.stringify(item.toolInput, null, 2);
};

/** "Read ×3 · Grep · Execute ×2" in first-use order. */
export const toolSummary = (calls: readonly ToolCall[]) => {
  const counts = new Map<string, number>();
  for (const call of calls) {
    const name = toolNameOf(call);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => (count > 1 ? `${name} ×${count}` : name))
    .join(" · ");
};

const ToolRow = ({ call, running }: { call: ToolCall; running: boolean }) => {
  const name = toolNameOf(call);
  const Icon = TOOL_ICONS[name] ?? WrenchIcon;
  const failed = call.result?.isError === true;
  const input = inputText(call.call);
  const summary = call.call?.text ?? call.result?.text ?? "";
  return (
    <Collapsible>
      <CollapsibleRow>
        <Icon aria-hidden="true" />
        <span className="shrink-0 font-medium text-text-secondary">{name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs">
          {summary}
        </span>
        {failed ? (
          <CircleAlertIcon aria-label="Failed" className="text-danger" />
        ) : null}
        {running && call.result === null ? (
          <Spinner label="Running" pattern="wave" size="sm" />
        ) : null}
      </CollapsibleRow>
      <CollapsibleContent>
        <div className="flex flex-col gap-sm py-xs pl-xl">
          {input ? <CodeBlock code={input} title="Input" /> : null}
          {call.result ? (
            <CodeBlock
              code={call.result.text || "(no output)"}
              title="Result"
              tone={failed ? "error" : "default"}
            />
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

/** A run of tool calls collapsed to one line; expands to each call and its result. */
export const ToolGroup = ({
  calls,
  running,
}: {
  calls: readonly ToolCall[];
  running: boolean;
}) => {
  const active = running && calls.some((call) => call.result === null);
  const failures = calls.filter((call) => call.result?.isError).length;
  return (
    <Collapsible defaultOpen={false}>
      <CollapsibleRow>
        {active ? (
          <Spinner label="Running tools" pattern="wave" size="sm" />
        ) : (
          <WrenchIcon aria-hidden="true" />
        )}
        <span className="min-w-0 truncate">{toolSummary(calls)}</span>
        {failures > 0 ? (
          <span className="shrink-0 text-danger">{failures} failed</span>
        ) : null}
      </CollapsibleRow>
      <CollapsibleContent>
        <div className="ml-sm flex flex-col border-l border-border-subtle pl-md">
          {calls.map((call) => (
            <ToolRow call={call} key={call.id} running={running} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};
