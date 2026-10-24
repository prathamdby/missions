"use client";

import { ClipboardIcon, SidebarIcon } from "@/components/mission/icons";
import { useMission } from "@/components/mission/mission-context";
import { useShell } from "@/components/shell/shell-context";
import { Badge } from "@/components/ui/badge";
import { useProjects } from "@/lib/api/queries";
import { formatDuration, isMissionActive } from "@/lib/format";
import { displayStatus } from "@/lib/mission/display-status";
import { modeStatus } from "@/lib/mission/execution-mode";
import { todoProgress } from "@/lib/mission/overview";
import { useNow } from "@/lib/use-now";

const useElapsed = (start: string, end: string | null) => {
  const now = useNow();
  const until = end ? Date.parse(end) : now;
  return formatDuration(until - Date.parse(start));
};

/** Paper J7R: the mobile header's todo pill, which opens the details sheet. */
const TodoPill = ({ onClick }: { onClick: () => void }) => {
  const { live } = useMission();
  const { items: todos, done } = todoProgress(live.todos, live.agents);
  return (
    <button
      aria-label={
        todos.length > 0
          ? `Mission details, ${done} of ${todos.length} todos done`
          : "Mission details"
      }
      className="flex h-9 shrink-0 cursor-pointer items-center gap-sm rounded-lg bg-surface-raised px-control text-sm leading-sm font-semibold tracking-tight text-text shadow-button transition-colors duration-fast hover:bg-surface-overlay"
      onClick={onClick}
      type="button"
    >
      <ClipboardIcon className="text-text-secondary" />
      {todos.length > 0 ? (
        <span className="tabular-nums">
          {done}/{todos.length}
        </span>
      ) : null}
    </button>
  );
};

export const MissionHeader = ({
  onTogglePanel,
  panelToggle,
}: {
  onTogglePanel: () => void;
  /** Only shown where the details panel is a sheet or can be hidden. */
  panelToggle: boolean;
}) => {
  const { live } = useMission();
  const { setNavOpen } = useShell();
  const { mission } = live;
  const projects = useProjects();
  const project = projects.data?.find(
    (entry) => entry.id === mission.projectId
  );
  const status = displayStatus(live);
  const mode = modeStatus(mission);
  const elapsed = useElapsed(
    mission.createdAt,
    isMissionActive(mission.status)
      ? null
      : (mission.endedAt ?? mission.updatedAt)
  );
  return (
    <header className="flex h-13 shrink-0 items-center gap-control border-b border-border-subtle pr-xl pl-gutter max-md:pr-lg max-md:pl-lg">
      <button
        aria-label="Open navigation"
        className="-ml-xs flex size-7 cursor-pointer items-center justify-center rounded-sm text-text-secondary hover:bg-surface-overlay md:hidden [&_svg]:size-4"
        onClick={() => setNavOpen(true)}
        type="button"
      >
        <SidebarIcon />
      </button>
      <div className="flex min-w-0 items-center gap-control max-md:flex-col max-md:items-start max-md:gap-0">
        <h1 className="min-w-0 truncate text-base leading-md font-semibold tracking-tight text-text max-md:max-w-full">
          {mission.title}
        </h1>
        <span className="truncate font-mono text-2xs leading-xs text-text-tertiary md:hidden">
          {project ? `${project.name} · ` : ""}
          {elapsed}
        </span>
      </div>
      <Badge
        className="max-md:hidden"
        data-testid="mission-status"
        dot
        tone={status.tone}
      >
        {status.label}
      </Badge>
      {mode ? (
        <Badge className="max-md:hidden" data-testid="mission-mode" tone="info">
          {mode}
        </Badge>
      ) : null}
      {project ? (
        <span className="font-mono text-2xs leading-xs text-text-tertiary max-md:hidden">
          {project.name}
        </span>
      ) : null}
      <span className="flex-1" />
      <span className="font-mono text-2xs leading-xs text-text-tertiary tabular-nums max-md:hidden">
        {elapsed}
      </span>
      {panelToggle ? <TodoPill onClick={onTogglePanel} /> : null}
    </header>
  );
};
