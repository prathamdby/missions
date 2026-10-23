"use client";

import type { Assignment, Todo } from "@missions/protocol/missions";
import {
  CheckIcon,
  CircleIcon,
  FileDiffIcon,
  FolderTreeIcon,
  ListChecksIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { useMission } from "@/components/mission/mission-context";
import { AgentDot } from "@/components/ui/avatar";
import { Badge, Tag } from "@/components/ui/badge";
import type { BadgeTone } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleRow,
} from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MISSION_TODOS } from "@/lib/live/mission-state";

const Section = ({
  children,
  count,
  title,
}: {
  children: ReactNode;
  count?: string;
  title: string;
}) => (
  <section aria-label={title} className="flex flex-col gap-sm">
    <h2 className="flex items-center gap-sm type-label text-text">
      {title}
      {count ? (
        <span className="font-mono text-2xs text-text-tertiary">{count}</span>
      ) : null}
    </h2>
    {children}
  </section>
);

const TodoMark = ({ status }: { status: Todo["status"] }) => {
  if (status === "in_progress") {
    return <Spinner label="In progress" size="sm" />;
  }
  if (status === "completed") {
    return (
      <CheckIcon
        aria-label="Done"
        className="size-3.5 shrink-0 text-text-tertiary"
      />
    );
  }
  return (
    <CircleIcon
      aria-label="Pending"
      className="size-3.5 shrink-0 text-text-tertiary"
    />
  );
};

const Todos = () => {
  const { live } = useMission();
  const own = live.todos[MISSION_TODOS];
  const todos = (
    own && own.length > 0 ? own : Object.values(live.todos).flat()
  ).toSorted((a, b) => a.position - b.position);
  const done = todos.filter((todo) => todo.status === "completed").length;
  return (
    <Section
      count={todos.length > 0 ? `${done}/${todos.length}` : undefined}
      title="Todos"
    >
      {todos.length === 0 ? (
        <p className="type-caption text-text-tertiary">
          Todos appear here once you approve a plan.
        </p>
      ) : (
        <ul className="flex flex-col gap-xs">
          {todos.map((todo) => (
            <li className="flex items-start gap-md py-2xs" key={todo.id}>
              <span className="mt-2xs flex size-3.5 items-center justify-center">
                <TodoMark status={todo.status} />
              </span>
              <span
                className={
                  todo.status === "completed"
                    ? "type-caption text-text-tertiary line-through"
                    : "type-caption text-text"
                }
              >
                {todo.content}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
};

const AGENT_STATUS: Record<string, string> = {
  failed: "Failed",
  idle: "Idle",
  interrupted: "Interrupted",
  starting: "Starting",
  stopped: "Stopped",
  stopping: "Stopping",
  waiting_answer: "Needs you",
  waiting_permission: "Needs you",
  working: "Working",
};

const Agents = () => {
  const { agentLabels, live } = useMission();
  const agents = Object.values(live.agents).toSorted((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  );
  return (
    <Section count={String(agents.length)} title="Agents">
      {agents.length === 0 ? (
        <p className="type-caption text-text-tertiary">
          Agents start once setup finishes.
        </p>
      ) : (
        <ul className="flex flex-col gap-xs">
          {agents.map((agent) => (
            <li
              className="flex items-center gap-md py-2xs type-caption"
              key={agent.id}
            >
              <span className="flex size-3.5 items-center justify-center">
                <AgentDot status={agent.status} />
              </span>
              <span className="min-w-0 flex-1 truncate text-text">
                {agent.workingState ?? agent.title}
              </span>
              <span className="shrink-0 text-text-tertiary">
                {agentLabels[agent.id]}
              </span>
              <span className="w-20 shrink-0 text-right text-text-secondary">
                {AGENT_STATUS[agent.status]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
};

const ASSIGNMENT_TONE: Record<Assignment["status"], BadgeTone> = {
  cancelled: "quiet",
  failed: "danger",
  handed_off: "success",
  queued: "neutral",
  running: "accent",
};

const ASSIGNMENT_LABEL: Record<Assignment["status"], string> = {
  cancelled: "Cancelled",
  failed: "Failed",
  handed_off: "Handed off",
  queued: "Queued",
  running: "Running",
};

const HandoffDetails = ({ assignment }: { assignment: Assignment }) => {
  const { handoff } = assignment;
  if (!handoff) {
    return null;
  }
  return (
    <Collapsible>
      <CollapsibleRow>Handoff</CollapsibleRow>
      <CollapsibleContent>
        <div className="flex flex-col gap-sm pb-sm type-caption text-text-secondary">
          <p className="text-text">{handoff.summary}</p>
          {handoff.filesChanged.length > 0 ? (
            <div className="flex flex-wrap gap-xs">
              {handoff.filesChanged.map((file) => (
                <Tag key={file}>{file}</Tag>
              ))}
            </div>
          ) : null}
          {handoff.checks.map((check) => (
            <p className="font-mono text-xs" key={check.command}>
              $ {check.command} · {check.outcome}
            </p>
          ))}
          {handoff.followUps.length > 0 ? (
            <ul className="list-disc pl-lg">
              {handoff.followUps.map((followUp) => (
                <li key={followUp}>{followUp}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

const Assignments = () => {
  const { agentLabels, live } = useMission();
  const assignments = Object.values(live.assignments).toSorted((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  );
  if (assignments.length === 0) {
    return null;
  }
  return (
    <Section count={String(assignments.length)} title="Assignments">
      <ul className="flex flex-col gap-md">
        {assignments.map((assignment) => (
          <li className="flex flex-col gap-xs" key={assignment.id}>
            <div className="flex items-center gap-md">
              <span className="min-w-0 flex-1 truncate type-caption text-text">
                {assignment.title}
              </span>
              {assignment.workerAgentId ? (
                <span className="type-caption text-text-tertiary">
                  {agentLabels[assignment.workerAgentId]}
                </span>
              ) : null}
              <Badge dot size="sm" tone={ASSIGNMENT_TONE[assignment.status]}>
                {ASSIGNMENT_LABEL[assignment.status]}
              </Badge>
            </div>
            <HandoffDetails assignment={assignment} />
          </li>
        ))}
      </ul>
    </Section>
  );
};

const Details = () => {
  const { live } = useMission();
  const { mission } = live;
  const rows: [string, ReactNode][] = [
    ["Orchestrator", mission.orchestrator.modelId],
    ["Workers", mission.worker.modelId],
  ];
  if (mission.workspace) {
    rows.push(["Workspace", mission.workspace.mode.replace("_", " ")]);
    if (mission.workspace.branch) {
      rows.push(["Branch", mission.workspace.branch]);
    }
    rows.push(["Path", mission.workspace.path]);
  }
  return (
    <Section title="Details">
      <dl className="flex flex-col gap-xs">
        {rows.map(([label, value]) => (
          <div className="flex gap-md type-caption" key={label}>
            <dt className="w-24 shrink-0 text-text-tertiary">{label}</dt>
            <dd className="min-w-0 flex-1 truncate font-mono text-xs text-text-secondary">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </Section>
  );
};

const Placeholder = ({
  icon,
  text,
  title,
}: {
  icon: ReactNode;
  text: string;
  title: string;
}) => (
  <div className="flex flex-col items-center gap-sm px-xl py-3xl text-center">
    <span className="text-text-tertiary [&_svg]:size-5">{icon}</span>
    <p className="type-label text-text">{title}</p>
    <p className="max-w-72 type-caption text-text-tertiary">{text}</p>
  </div>
);

/** Overview / Digest / Files / Changes. Only Overview is live in this milestone. */
export const RightPanel = () => (
  <Tabs className="flex min-h-0 flex-1 flex-col" defaultValue="overview">
    <div className="flex h-12 shrink-0 items-center border-b border-border-subtle px-lg">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="digest">Digest</TabsTrigger>
        <TabsTrigger value="files">Files</TabsTrigger>
        <TabsTrigger value="changes">Changes</TabsTrigger>
      </TabsList>
    </div>
    <TabsContent className="overflow-y-auto" value="overview">
      <div className="flex flex-col gap-xl p-lg">
        <Todos />
        <Agents />
        <Assignments />
        <Details />
      </div>
    </TabsContent>
    <TabsContent value="digest">
      <Placeholder
        icon={<ListChecksIcon aria-hidden="true" />}
        text="A running summary of decisions and progress arrives in a later milestone."
        title="Digest"
      />
    </TabsContent>
    <TabsContent value="files">
      <Placeholder
        icon={<FolderTreeIcon aria-hidden="true" />}
        text="Browse the mission workspace here in a later milestone."
        title="Files"
      />
    </TabsContent>
    <TabsContent value="changes">
      <Placeholder
        icon={<FileDiffIcon aria-hidden="true" />}
        text="Review diffs, commit, push, and open a pull request here in a later milestone."
        title="Changes"
      />
    </TabsContent>
  </Tabs>
);
