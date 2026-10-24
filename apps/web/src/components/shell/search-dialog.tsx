"use client";

import type { MissionSummary } from "@missions/protocol/missions";
import type { Project } from "@missions/protocol/projects";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { KeyboardEvent } from "react";

import { useShell } from "@/components/shell/shell-context";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { FolderIcon, SearchIcon, TaskDoneIcon } from "@/components/ui/icons";
import {
  ListLabel,
  ListOption,
  Listbox,
  ListboxGroup,
} from "@/components/ui/list-row";
import { useMissions, useProjects } from "@/lib/api/queries";
import { MISSION_STATUS } from "@/lib/format";

const MAX_RESULTS = 8;

type Result =
  | { id: string; kind: "mission"; mission: MissionSummary; project?: Project }
  | { id: string; kind: "project"; project: Project };

const includes = (value: string, needle: string) =>
  value.toLowerCase().includes(needle);

const buildResults = (
  query: string,
  missions: readonly MissionSummary[],
  projects: readonly Project[]
): Result[] => {
  const needle = query.trim().toLowerCase();
  const byId = new Map(projects.map((project) => [project.id, project]));
  const missionResults: Result[] = missions
    .filter((mission) => mission.status !== "archived")
    .filter(
      (mission) =>
        !needle ||
        includes(mission.title, needle) ||
        includes(byId.get(mission.projectId)?.name ?? "", needle)
    )
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MAX_RESULTS)
    .map((mission) => ({
      id: `mission-${mission.id}`,
      kind: "mission",
      mission,
      project: byId.get(mission.projectId),
    }));
  const projectResults: Result[] = projects
    .filter(
      (project) =>
        !needle ||
        includes(project.name, needle) ||
        includes(project.path, needle)
    )
    .slice(0, MAX_RESULTS)
    .map((project) => ({
      id: `project-${project.id}`,
      kind: "project",
      project,
    }));
  return [...missionResults, ...projectResults];
};

const ResultRow = ({
  active,
  onHover,
  onSelect,
  result,
}: {
  active: boolean;
  onHover: () => void;
  onSelect: () => void;
  result: Result;
}) => (
  <ListOption
    data-highlighted={active ? "" : undefined}
    id={result.id}
    onClick={onSelect}
    onMouseMove={onHover}
    selected={active}
    size="menu"
    tabIndex={-1}
  >
    {result.kind === "mission" ? <TaskDoneIcon /> : <FolderIcon />}
    <span className="min-w-0 flex-1 truncate">
      {result.kind === "mission" ? result.mission.title : result.project.name}
    </span>
    <span className="shrink-0 truncate text-xs leading-sm text-text-tertiary">
      {result.kind === "mission"
        ? `${result.project?.name ?? ""} · ${MISSION_STATUS[result.mission.status].label}`
        : result.project.path}
    </span>
  </ListOption>
);

const SearchPanel = ({ onClose }: { onClose: () => void }) => {
  const router = useRouter();
  const { preferProject } = useShell();
  const missions = useMissions();
  const projects = useProjects();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const results = buildResults(query, missions.data ?? [], projects.data ?? []);
  const active = results[Math.min(activeIndex, results.length - 1)];

  const select = (result: Result | undefined) => {
    if (!result) {
      return;
    }
    onClose();
    if (result.kind === "mission") {
      router.push(`/missions/${result.mission.id}`);
    } else {
      preferProject(result.project.id);
      router.push("/");
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      select(active);
    }
  };

  const missionResults = results.filter((result) => result.kind === "mission");
  const projectResults = results.filter((result) => result.kind === "project");

  const renderRow = (result: Result) => (
    <ResultRow
      active={result.id === active?.id}
      key={result.id}
      onHover={() => setActiveIndex(results.indexOf(result))}
      onSelect={() => select(result)}
      result={result}
    />
  );

  return (
    <>
      <div className="flex h-11 shrink-0 items-center gap-md border-b border-border-subtle px-lg">
        <SearchIcon tone="tertiary" />
        <input
          aria-activedescendant={active?.id}
          aria-controls="search-results"
          aria-expanded="true"
          aria-label="Search missions and projects"
          className="min-w-0 flex-1 bg-transparent text-sm leading-sm text-text outline-none placeholder:text-text-tertiary"
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search missions and projects"
          role="combobox"
          value={query}
        />
      </div>
      <div className="max-h-96 min-h-0 overflow-y-auto p-xs">
        <Listbox aria-label="Results" id="search-results">
          {missionResults.length > 0 ? (
            <ListboxGroup>
              <ListLabel>Missions</ListLabel>
              {missionResults.map(renderRow)}
            </ListboxGroup>
          ) : null}
          {projectResults.length > 0 ? (
            <ListboxGroup>
              <ListLabel>Projects</ListLabel>
              {projectResults.map(renderRow)}
            </ListboxGroup>
          ) : null}
          {results.length === 0 ? (
            <p className="px-md py-lg text-xs leading-sm text-text-tertiary">
              Nothing matches “{query.trim()}”.
            </p>
          ) : null}
        </Listbox>
      </div>
    </>
  );
};

/** Jump to a mission or start one in a project. */
export const SearchDialog = () => {
  const { searchOpen, setSearchOpen } = useShell();
  return (
    <Dialog onOpenChange={setSearchOpen} open={searchOpen}>
      <DialogContent size="md">
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">
          Type to filter missions and projects, then press Enter to open one.
        </DialogDescription>
        {searchOpen ? (
          <SearchPanel onClose={() => setSearchOpen(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
};
