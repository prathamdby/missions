"use client";

import { BrainIcon } from "lucide-react";

import { useMission } from "@/components/mission/mission-context";
import { PermissionCard } from "@/components/mission/permission-card";
import { PlanCard } from "@/components/mission/plan-card";
import { QuestionCard } from "@/components/mission/question-card";
import { ToolGroup } from "@/components/mission/tool-group";
import { AgentDot } from "@/components/ui/avatar";
import { Callout } from "@/components/ui/callout";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleRow,
} from "@/components/ui/collapsible";
import { Markdown } from "@/components/ui/markdown";
import { Spinner } from "@/components/ui/spinner";
import type { TimelineEntry } from "@/lib/mission/timeline";

const UserMessage = ({ text }: { text: string }) => (
  <div className="ml-auto max-w-prose rounded-lg bg-surface-raised px-lg py-md type-body break-words whitespace-pre-wrap text-text">
    {text}
  </div>
);

const Thinking = ({ text }: { text: string }) => (
  <Collapsible>
    <CollapsibleRow>
      <BrainIcon aria-hidden="true" />
      Thought
    </CollapsibleRow>
    <CollapsibleContent>
      <p className="border-l border-border-subtle py-xs pl-lg type-caption whitespace-pre-wrap text-text-secondary">
        {text}
      </p>
    </CollapsibleContent>
  </Collapsible>
);

const SystemLine = ({ text }: { text: string }) => (
  <div className="flex items-center gap-md type-caption text-text-tertiary">
    <span className="h-px flex-1 bg-border-subtle" />
    <span className="max-w-prose text-center">{text}</span>
    <span className="h-px flex-1 bg-border-subtle" />
  </div>
);

const AgentLabel = ({ agentId }: { agentId: string }) => {
  const { agentLabels, live } = useMission();
  const agent = live.agents[agentId];
  return (
    <p className="flex items-center gap-sm pt-sm type-caption text-text-tertiary">
      {agent ? <AgentDot status={agent.status} /> : null}
      <span className="font-medium text-text-secondary">
        {agentLabels[agentId] ?? "Agent"}
      </span>
      {agent && agent.role === "worker" ? (
        <span className="truncate">{agent.title}</span>
      ) : null}
    </p>
  );
};

const EntryBody = ({
  entry,
  running,
}: {
  entry: TimelineEntry;
  running: boolean;
}) => {
  switch (entry.kind) {
    case "user": {
      return <UserMessage text={entry.item.text} />;
    }
    case "assistant": {
      return <Markdown>{entry.item.text}</Markdown>;
    }
    case "thinking": {
      return <Thinking text={entry.item.text} />;
    }
    case "system": {
      return <SystemLine text={entry.item.text} />;
    }
    case "error": {
      return (
        <Callout title="The agent hit an error" tone="danger">
          {entry.item.text}
        </Callout>
      );
    }
    case "tools": {
      return <ToolGroup calls={entry.calls} running={running} />;
    }
    case "preview": {
      return entry.previewKind === "thinking" ? (
        <p className="flex items-center gap-md type-caption text-text-tertiary">
          <Spinner label="Thinking" size="sm" />
          Thinking…
        </p>
      ) : (
        <Markdown>{entry.text}</Markdown>
      );
    }
    case "permission": {
      return <PermissionCard request={entry.request} />;
    }
    case "plan": {
      return <PlanCard latest={entry.latest} plan={entry.plan} />;
    }
    case "question": {
      return <QuestionCard question={entry.question} />;
    }
    default: {
      return null;
    }
  }
};

const ATTRIBUTED = new Set<TimelineEntry["kind"]>([
  "assistant",
  "preview",
  "thinking",
  "tools",
]);

/** Marks entries where the speaking agent changes; a worker speaking first is labelled too. */
const labelSpeakers = (
  entries: readonly TimelineEntry[],
  isWorker: (agentId: string) => boolean
) => {
  const rows: { entry: TimelineEntry; label: string | null }[] = [];
  let speaker: string | null = null;
  for (const entry of entries) {
    const agentId = ATTRIBUTED.has(entry.kind) ? entry.agentId : null;
    let label: string | null = null;
    if (agentId !== null) {
      if (agentId !== speaker && (speaker !== null || isWorker(agentId))) {
        label = agentId;
      }
      speaker = agentId;
    } else if (entry.kind === "user") {
      speaker = null;
    }
    rows.push({ entry, label });
  }
  return rows;
};

/**
 * Transcript entries with an agent label wherever the speaking agent changes,
 * so worker output reads as distinct from the Orchestrator's.
 */
export const Transcript = ({
  entries,
  running,
}: {
  entries: readonly TimelineEntry[];
  running: boolean;
}) => {
  const { live } = useMission();
  const rows = labelSpeakers(
    entries,
    (agentId) => live.agents[agentId]?.role === "worker"
  );
  return (
    <ol aria-label="Mission transcript" className="flex flex-col gap-lg">
      {rows.map(({ entry, label }) => (
        <li className="flex min-w-0 flex-col gap-sm" key={entry.id}>
          {label ? <AgentLabel agentId={label} /> : null}
          <EntryBody entry={entry} running={running} />
        </li>
      ))}
    </ol>
  );
};
