"use client";

import type { MissionSummary } from "@missions/protocol/missions";
import type { Project } from "@missions/protocol/projects";
import { FolderIcon, PlusIcon, SettingsIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ListLabel, ListRow } from "@/components/ui/list-row";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useMissions, useProjects } from "@/lib/api/queries";
import { isMissionActive, MISSION_STATUS, shortAge } from "@/lib/format";
import { useConnection } from "@/lib/live/hooks";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

const AGE_REFRESH_MS = 30_000;

const MissionRowStatus = ({
  mission,
  now,
}: {
  mission: MissionSummary;
  now: number;
}) => {
  if (isMissionActive(mission.status)) {
    return <Spinner label={MISSION_STATUS[mission.status].label} size="sm" />;
  }
  if (mission.status === "awaiting_approval") {
    return <span className="type-micro text-warning">Needs you</span>;
  }
  if (mission.status === "failed" || mission.status === "stop_failed") {
    return (
      <span className="type-micro text-danger">
        {MISSION_STATUS[mission.status].label}
      </span>
    );
  }
  if (mission.status === "paused" || mission.status === "interrupted") {
    return (
      <span className="type-micro text-text-tertiary">
        {MISSION_STATUS[mission.status].label}
      </span>
    );
  }
  return (
    <span className="font-mono text-2xs text-text-tertiary">
      {shortAge(mission.updatedAt, now)}
    </span>
  );
};

interface ProjectGroup {
  missions: MissionSummary[];
  project: Project;
}

const groupByProject = (projects: Project[], missions: MissionSummary[]) => {
  const groups: ProjectGroup[] = projects.map((project) => ({
    missions: missions
      .filter((mission) => mission.projectId === project.id)
      .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    project,
  }));
  const latest = (group: ProjectGroup) => group.missions[0]?.updatedAt ?? "";
  return groups.toSorted((a, b) => latest(b).localeCompare(latest(a)));
};

const MissionList = () => {
  const pathname = usePathname();
  const projects = useProjects();
  const missions = useMissions();
  const now = useNow(AGE_REFRESH_MS);

  if (projects.data === undefined) {
    return projects.isError ? (
      <p className="px-md py-md type-caption text-text-tertiary">
        Projects appear here once the daemon is reachable.
      </p>
    ) : (
      <div className="flex flex-col gap-md px-md py-md">
        <Skeleton className="w-24" />
        <Skeleton />
        <Skeleton className="w-3/4" />
      </div>
    );
  }

  const groups = groupByProject(projects.data, missions.data ?? []);
  if (groups.length === 0) {
    return (
      <p className="px-md py-md type-caption text-text-tertiary">
        No projects yet. Add one to start a mission.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2xs pb-lg">
      {groups.map(({ missions: list, project }) => (
        <section aria-label={project.name} key={project.id}>
          <ListLabel>
            <span className="flex items-center gap-sm">
              <FolderIcon aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="truncate">{project.name}</span>
            </span>
          </ListLabel>
          {list.length === 0 ? (
            <p className="px-md py-xs type-caption text-text-disabled">
              No missions yet
            </p>
          ) : (
            <ul className="flex flex-col gap-2xs">
              {list.map((mission) => {
                const href = `/missions/${mission.id}`;
                return (
                  <li key={mission.id}>
                    <ListRow asChild size="md">
                      <Link
                        aria-current={pathname === href ? "page" : undefined}
                        href={href}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {mission.title}
                        </span>
                        <MissionRowStatus mission={mission} now={now} />
                      </Link>
                    </ListRow>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
};

const DAEMON_LABEL = {
  connecting: "Connecting to daemon",
  offline: "Daemon offline",
  online: "Daemon connected",
} as const;

const DAEMON_DOT = {
  connecting: "bg-text-tertiary",
  offline: "bg-danger",
  online: "bg-success",
} as const;

const DaemonStatus = () => {
  const { phase } = useConnection();
  return (
    <output className="flex h-8 items-center gap-md px-md type-caption text-text-tertiary">
      <span
        aria-hidden="true"
        className={cn("size-1.5 rounded-full", DAEMON_DOT[phase])}
      />
      {DAEMON_LABEL[phase]}
    </output>
  );
};

export const Sidebar = () => {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Missions"
      className="flex h-full min-h-0 w-full flex-col gap-xs px-md pt-lg pb-md"
    >
      <div className="flex h-8 items-center gap-md px-md">
        <span aria-hidden="true" className="size-3.5 rounded-xs bg-accent" />
        <span className="type-label font-semibold text-text">Missions</span>
      </div>
      <ListRow asChild size="nav">
        <Link aria-current={pathname === "/" ? "page" : undefined} href="/">
          <PlusIcon aria-hidden="true" />
          New mission
        </Link>
      </ListRow>
      <ScrollArea className="-mx-md mt-sm min-h-0 flex-1">
        <div className="px-md">
          <MissionList />
        </div>
      </ScrollArea>
      <div className="flex flex-col gap-2xs border-t border-border-subtle pt-sm">
        <ListRow asChild size="md">
          <Link
            aria-current={pathname === "/settings" ? "page" : undefined}
            href="/settings"
          >
            <SettingsIcon aria-hidden="true" />
            Settings
          </Link>
        </ListRow>
        <DaemonStatus />
      </div>
    </nav>
  );
};
