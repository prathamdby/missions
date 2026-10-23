"use client";

import type { Artifact, Todo } from "@missions/protocol/missions";
import { useQuery } from "@tanstack/react-query";
import Image from "next/image";

import {
  CheckIcon,
  CircleIcon,
  CloseIcon,
  MergeIcon,
  PauseIcon,
  PullRequestIcon,
  WarningIcon,
} from "@/components/mission/icons";
import { useMission } from "@/components/mission/mission-context";
import {
  DotLoader,
  IconCell,
  PanelSection,
  StaticSelect,
} from "@/components/mission/panel-kit";
import { api } from "@/lib/api/endpoints";
import { useChanges, useModels } from "@/lib/api/queries";
import { formatDuration, shortAge } from "@/lib/format";
import { agentRows, groupTodos } from "@/lib/mission/overview";
import type { AgentRow } from "@/lib/mission/overview";
import { checksLabel, effortLabel, prRef } from "@/lib/mission/pr";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

const TodoRow = ({ active, todo }: { active: boolean; todo: Todo }) => {
  let icon = <CircleIcon className="text-text-disabled" />;
  if (todo.status === "completed") {
    icon = <CheckIcon className="text-text-tertiary" />;
  } else if (todo.status === "in_progress") {
    icon = <DotLoader />;
  }
  return (
    <li
      className={cn(
        "flex h-7 shrink-0 items-center gap-control rounded-sm px-md",
        active && "bg-surface-raised"
      )}
    >
      <IconCell>{icon}</IconCell>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm leading-sm tracking-tight",
          todo.status === "completed" &&
            "font-book text-text-tertiary line-through decoration-border-strong",
          todo.status === "in_progress" && "font-medium text-text",
          todo.status === "pending" && "font-book text-text-secondary"
        )}
      >
        <span className="sr-only">
          {todo.status === "completed" ? "Done: " : ""}
          {todo.status === "in_progress" ? "In progress: " : ""}
        </span>
        {todo.content}
      </span>
    </li>
  );
};

const TodoList = ({ todos }: { todos: readonly Todo[] }) => {
  const firstActive = todos.find((todo) => todo.status === "in_progress");
  return (
    <ul className="-mx-md flex flex-col gap-2xs">
      {todos.map((todo) => (
        <TodoRow active={todo === firstActive} key={todo.id} todo={todo} />
      ))}
    </ul>
  );
};

const Todos = () => {
  const { agentLabels, live } = useMission();
  const groups = groupTodos(live.todos, live.agents);
  const all = [...groups.main, ...groups.workers.flatMap((g) => g.todos)];
  if (all.length === 0) {
    return (
      <PanelSection title="Todos">
        <p className="text-xs leading-sm text-text-tertiary">
          Todos appear here once you approve a plan.
        </p>
      </PanelSection>
    );
  }
  const counted = groups.main.length > 0 ? groups.main : all;
  const done = counted.filter((todo) => todo.status === "completed").length;
  // Worker checklists only stand in for a missing mission plan; otherwise the
  // Agents section already shows what each Worker is on.
  const workers = groups.main.length > 0 ? [] : groups.workers;
  const draft =
    live.mission.status === "exploring" ||
    live.mission.status === "awaiting_approval";
  return (
    <PanelSection count={`${done}/${counted.length}`} title="Todos">
      {groups.main.length > 0 ? <TodoList todos={groups.main} /> : null}
      {draft ? (
        <p className="py-xs text-xs leading-sm tracking-tight text-text-tertiary">
          Draft. Starts when you approve the plan.
        </p>
      ) : null}
      {workers.map((group) => (
        <div className="flex flex-col gap-xs" key={group.agentId}>
          <span className="pt-xs text-xs leading-sm text-text-tertiary">
            {agentLabels[group.agentId] ?? "Worker"}
          </span>
          <TodoList todos={group.todos} />
        </div>
      ))}
    </PanelSection>
  );
};

const PullRequests = () => {
  const { live, missionId } = useMission();
  const { mission } = live;
  const { pr } = mission.publish;
  const changes = useChanges(missionId, live.workspaceSeq, pr !== null);
  const now = useNow();
  if (!pr) {
    return null;
  }
  const merged = pr.state === "merged";
  const Icon = merged ? MergeIcon : PullRequestIcon;
  const totals = changes.data?.totals;
  const base = mission.workspace?.baseRef ?? "main";
  const branch = mission.publish.pushedBranch ?? mission.workspace?.branch;
  const checks = checksLabel(pr.checks);
  return (
    <PanelSection count={1} title="Pull requests">
      <div className="-mx-md flex flex-col">
        <a
          className="flex gap-control rounded-sm p-md transition-colors duration-fast hover:bg-surface-raised"
          href={pr.url}
          rel="noopener noreferrer"
          target="_blank"
        >
          <Icon
            className={cn(
              pr.state === "closed" ? "text-text-tertiary" : "text-success"
            )}
          />
          <span className="flex min-w-0 flex-1 flex-col gap-xs">
            <span className="flex items-baseline gap-md">
              <span className="shrink-0 font-mono text-2xs leading-sm text-text-tertiary">
                {prRef(pr)}
              </span>
              <span className="truncate text-sm leading-sm font-medium tracking-tight text-text">
                {mission.title}
              </span>
            </span>
            <span className="flex flex-wrap gap-md font-mono text-2xs leading-xs">
              <span className="text-text-tertiary">
                {base} ← {branch}
              </span>
              {totals ? (
                <>
                  <span className="text-success">+{totals.additions}</span>
                  <span className="text-danger">−{totals.deletions}</span>
                </>
              ) : null}
              {merged ? (
                <span className="text-text-tertiary">
                  · merged {shortAge(pr.updatedAt, now)} ago
                </span>
              ) : null}
              {!merged && checks ? (
                <span className="text-text-tertiary">· {checks}</span>
              ) : null}
            </span>
          </span>
        </a>
      </div>
    </PanelSection>
  );
};

const TEXT_TYPES = /^(?:text\/|application\/(?:json|xml|yaml))/u;
const PREVIEW_CHARS = 240;
const HEADING = /^#+\s*/u;

const ArtifactPreview = ({ artifact }: { artifact: Artifact }) => {
  const { missionId } = useMission();
  const url = api.artifactUrl(missionId, artifact.id);
  const isText = TEXT_TYPES.test(artifact.mediaType);
  const text = useQuery({
    enabled: isText,
    queryFn: async () => {
      const response = await fetch(url);
      const body = await response.text();
      return body.slice(0, PREVIEW_CHARS);
    },
    queryKey: ["artifact-preview", missionId, artifact.id],
    staleTime: Infinity,
  });
  if (artifact.kind === "image") {
    return (
      <Image
        alt=""
        className="size-full object-cover"
        height={100}
        src={url}
        unoptimized
        width={108}
      />
    );
  }
  const lines = (text.data ?? "").split("\n").filter(Boolean);
  const [first, ...rest] = lines;
  const title = first ? first.replace(HEADING, "") : artifact.name;
  return (
    <span className="flex w-38.5 origin-top-left scale-70 flex-col gap-sm">
      <span className="text-xs leading-sm font-semibold tracking-tight text-text">
        {title}
      </span>
      <span className="line-clamp-6 text-2xs leading-xs font-book tracking-tight text-text-secondary">
        {rest.join(" ") || artifact.mediaType}
      </span>
    </span>
  );
};

const MAX_FILE_CARDS = 5;

const Files = () => {
  const { live, missionId } = useMission();
  const now = useNow();
  const artifacts = Object.values(live.artifacts).toSorted((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
  if (artifacts.length === 0) {
    return null;
  }
  return (
    <PanelSection count={artifacts.length} gap="lg" title="Files">
      <ul className="flex gap-control overflow-hidden">
        {artifacts.slice(0, MAX_FILE_CARDS).map((artifact) => {
          const agent = artifact.agentId
            ? live.agents[artifact.agentId]
            : undefined;
          const role = agent?.role === "worker" ? "Worker" : "Orchestrator";
          return (
            <li
              className="flex w-27 shrink-0 flex-col gap-md"
              key={artifact.id}
            >
              <a
                aria-label={`Open ${artifact.name}`}
                className="flex h-25 shrink-0 flex-col overflow-hidden rounded-md bg-surface-raised p-md shadow-sm"
                href={api.artifactUrl(missionId, artifact.id)}
                rel="noopener noreferrer"
                target="_blank"
              >
                <ArtifactPreview artifact={artifact} />
              </a>
              <span className="flex flex-col gap-2xs">
                <span className="line-clamp-1 text-xs leading-sm font-medium tracking-tight text-text">
                  {artifact.name}
                </span>
                <span className="text-2xs leading-xs tracking-tight text-text-tertiary">
                  {role} · {shortAge(artifact.createdAt, now)}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </PanelSection>
  );
};

const AgentIcon = ({ phase }: { phase: AgentRow["phase"] }) => {
  if (phase === "working") {
    return <DotLoader label="Working" tone="accent" />;
  }
  if (phase === "needs_you") {
    return <WarningIcon className="size-3.5 text-warning" />;
  }
  if (phase === "failed") {
    return <CloseIcon className="text-danger" />;
  }
  if (phase === "blocked") {
    return <WarningIcon className="size-3.5 text-danger" />;
  }
  if (phase === "done") {
    return <CheckIcon className="text-text-tertiary" />;
  }
  return <PauseIcon className="size-3.5 text-text-tertiary" />;
};

const AgentStatusCell = ({ row }: { row: AgentRow }) => {
  const now = useNow();
  const ended = row.endedAt ? Date.parse(row.endedAt) : now;
  const duration = formatDuration(ended - Date.parse(row.startedAt));
  const base = "flex w-16 shrink-0 justify-end text-right";
  if (row.phase === "needs_you") {
    return (
      <span className={cn(base, "font-mono text-2xs leading-xs text-warning")}>
        Needs you
      </span>
    );
  }
  if (row.phase === "failed" || row.phase === "blocked") {
    return (
      <span className={cn(base, "font-mono text-2xs leading-xs text-danger")}>
        {row.phase === "failed" ? "Failed" : "Blocked"}
      </span>
    );
  }
  if (row.phase === "stopped" || row.phase === "idle") {
    return (
      <span
        className={cn(
          base,
          "text-xs leading-sm tracking-tight text-text-tertiary"
        )}
      >
        {row.phase === "idle" ? "Idle" : "Paused"}
      </span>
    );
  }
  return (
    <span
      className={cn(
        base,
        "font-mono text-2xs leading-xs",
        row.phase === "working" ? "text-text-secondary" : "text-text-tertiary"
      )}
    >
      {duration}
    </span>
  );
};

const Agents = () => {
  const { agentLabels, live } = useMission();
  const rows = agentRows(
    live.agents,
    live.assignments,
    live.todos,
    agentLabels,
    {
      awaitingApproval: live.mission.status === "awaiting_approval",
      environmentBlocked: live.mission.lastError?.code === "environment",
      planApprovedAt:
        Object.values(live.plans).find((plan) => plan.status === "approved")
          ?.decidedAt ?? null,
    }
  );
  if (rows.length === 0) {
    return (
      <PanelSection title="Agents">
        <p className="text-xs leading-sm text-text-tertiary">
          Agents start once setup finishes.
        </p>
      </PanelSection>
    );
  }
  return (
    <PanelSection count={rows.length} title="Agents">
      <ul className="-mx-md flex flex-col">
        {rows.map((row) => (
          <li
            className="flex h-8.5 shrink-0 items-center gap-control rounded-sm px-md"
            key={row.id}
            title={row.label}
          >
            <IconCell>
              <AgentIcon phase={row.phase} />
            </IconCell>
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm leading-sm font-book tracking-tight",
                row.phase === "done" ? "text-text-secondary" : "text-text"
              )}
            >
              {row.activity}
            </span>
            <span className="shrink-0 text-xs leading-sm tracking-tight text-text-tertiary">
              {row.role === "orchestrator" ? "Orchestrator" : "Worker"}
            </span>
            <AgentStatusCell row={row} />
          </li>
        ))}
      </ul>
    </PanelSection>
  );
};

const ModelRow = ({
  effort,
  label,
  modelId,
}: {
  effort: string | null;
  label: string;
  modelId: string;
}) => {
  const models = useModels();
  const name =
    models.data?.models.find((model) => model.id === modelId)?.displayName ??
    modelId;
  const thinking = effortLabel(effort);
  return (
    <div className="flex h-9 shrink-0 items-center gap-lg">
      <span className="min-w-0 flex-1 text-sm leading-sm font-book tracking-tight text-text-secondary">
        {label}
      </span>
      <StaticSelect
        className="w-29 justify-between"
        href="/settings"
        label={`${label} model: ${name}. Fixed for this mission; change defaults in Settings.`}
      >
        <span className="truncate font-mono text-2xs leading-xs text-text">
          {name}
        </span>
      </StaticSelect>
      <StaticSelect
        className="w-36"
        href="/settings"
        label={`${label} thinking: ${thinking}. Fixed for this mission; change defaults in Settings.`}
      >
        <span className="text-xs leading-sm font-book tracking-tight text-text-tertiary">
          Thinking
        </span>
        <span className="min-w-0 flex-1 truncate text-xs leading-sm font-medium tracking-tight text-text">
          {thinking}
        </span>
      </StaticSelect>
    </div>
  );
};

const Models = () => {
  const { live } = useMission();
  const { orchestrator, worker } = live.mission;
  return (
    <PanelSection gap="xs" grow title="Models">
      <ModelRow
        effort={orchestrator.reasoningEffort}
        label="Orchestrator"
        modelId={orchestrator.modelId}
      />
      <ModelRow
        effort={worker.reasoningEffort}
        label="Workers"
        modelId={worker.modelId}
      />
    </PanelSection>
  );
};

/** Paper FQQ right panel, Overview tab. */
export const OverviewTab = () => (
  <>
    <Todos />
    <PullRequests />
    <Files />
    <Agents />
    <Models />
  </>
);
