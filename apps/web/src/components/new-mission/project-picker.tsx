"use client";

import type { MissionSummary } from "@missions/protocol/missions";
import type { Project } from "@missions/protocol/projects";
import {
  CheckIcon,
  CloudDownloadIcon,
  FolderIcon,
  FolderOpenIcon,
  LinkIcon,
  SearchIcon,
} from "lucide-react";
import { useState } from "react";

import { PickerButton } from "@/components/new-mission/picker-button";
import { useAddProject } from "@/components/projects/add-project-context";
import { Input } from "@/components/ui/input";
import { ListLabel, ListRow } from "@/components/ui/list-row";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { isMissionActive } from "@/lib/format";

interface ProjectPickerProps {
  missions: readonly MissionSummary[];
  onChange: (projectId: string) => void;
  projects: readonly Project[];
  value: string | null;
}

const projectMeta = (
  projectId: string,
  missions: readonly MissionSummary[]
) => {
  const own = missions.filter((mission) => mission.projectId === projectId);
  const running = own.filter((mission) =>
    isMissionActive(mission.status)
  ).length;
  if (running > 0) {
    return `${running} running`;
  }
  if (own.length === 0) {
    return "";
  }
  return own.length === 1 ? "1 mission" : `${own.length} missions`;
};

const matches = (query: string, project: Project) => {
  const needle = query.trim().toLowerCase();
  return (
    !needle ||
    project.name.toLowerCase().includes(needle) ||
    project.path.toLowerCase().includes(needle)
  );
};

/** LTT: switch projects or start one of the add-project flows. */
export const ProjectPicker = ({
  missions,
  onChange,
  projects,
  value,
}: ProjectPickerProps) => {
  const { openAddProject } = useAddProject();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = projects.find((project) => project.id === value);
  const filtered = projects.filter((project) => matches(search, project));

  const add = (start: "browse" | "github" | "url") => {
    setOpen(false);
    openAddProject(start);
  };

  return (
    <Popover
      onOpenChange={(next) => {
        setOpen(next);
        setSearch("");
      }}
      open={open}
    >
      <PopoverTrigger asChild>
        <PickerButton
          aria-label="Project"
          icon={<FolderIcon aria-hidden="true" />}
          label={selected?.name ?? "Choose a project"}
        />
      </PopoverTrigger>
      <PopoverContent>
        <div className="border-b border-border-subtle p-sm">
          <Input
            aria-label="Search projects"
            leading={<SearchIcon aria-hidden="true" />}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search projects"
            value={search}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-xs">
          <ListLabel>Projects</ListLabel>
          {filtered.length === 0 ? (
            <p className="px-md py-sm type-caption text-text-tertiary">
              No matching projects
            </p>
          ) : null}
          {filtered.map((project) => (
            <ListRow
              aria-pressed={project.id === value}
              key={project.id}
              onClick={() => {
                onChange(project.id);
                setOpen(false);
              }}
              size="lg"
            >
              <FolderIcon aria-hidden="true" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate type-label text-text">
                  {project.name}
                </span>
                <span className="truncate font-mono text-2xs text-text-tertiary">
                  {project.path}
                </span>
              </span>
              <span className="type-caption text-text-tertiary">
                {projectMeta(project.id, missions)}
              </span>
              {project.id === value ? (
                <CheckIcon aria-hidden="true" />
              ) : (
                <span aria-hidden="true" className="size-4" />
              )}
            </ListRow>
          ))}
          <ListLabel>Add project</ListLabel>
          <ListRow onClick={() => add("browse")}>
            <FolderOpenIcon aria-hidden="true" />
            Open local folder…
          </ListRow>
          <ListRow onClick={() => add("github")}>
            <CloudDownloadIcon aria-hidden="true" />
            Clone from GitHub…
          </ListRow>
          <ListRow onClick={() => add("url")}>
            <LinkIcon aria-hidden="true" />
            Clone from URL…
          </ListRow>
        </div>
      </PopoverContent>
    </Popover>
  );
};
