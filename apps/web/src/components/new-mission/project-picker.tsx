"use client";

import type { MissionSummary } from "@missions/protocol/missions";
import type { Project } from "@missions/protocol/projects";
import { useEffect, useRef, useState } from "react";

import { PickerButton } from "@/components/new-mission/picker-button";
import {
  projectMeta,
  recentProjects,
} from "@/components/new-mission/project-list";
import { useAddProject } from "@/components/projects/add-project-context";
import { useHomeDir } from "@/components/projects/use-home-dir";
import {
  CheckIcon,
  FolderAddIcon,
  FolderIcon,
  GithubIcon,
  LinkIcon,
  SearchIcon,
} from "@/components/ui/icons";
import { Kbd } from "@/components/ui/kbd";
import {
  ListLabel,
  ListOption,
  ListRow,
  Listbox,
} from "@/components/ui/list-row";
import {
  Popover,
  PopoverContent,
  PopoverSearch,
  PopoverSeparator,
  PopoverTrigger,
} from "@/components/ui/popover";
import { tildePath } from "@/lib/format";
import { cn } from "@/lib/utils";

interface ProjectPickerProps {
  missions: readonly MissionSummary[];
  onChange: (projectId: string) => void;
  projects: readonly Project[];
  value: string | null;
}

const ProjectOption = ({
  home,
  meta,
  onPick,
  project,
  selected,
}: {
  home: string | null;
  meta: string;
  onPick: () => void;
  project: Project;
  selected: boolean;
}) => (
  <ListOption onClick={onPick} selected={selected} size="menu-lg">
    <FolderIcon />
    <span className="flex min-w-0 flex-1 flex-col gap-2xs">
      <span
        className={cn(
          "truncate font-medium group-hover/list-row:text-text",
          selected ? "text-text" : "text-text-secondary"
        )}
      >
        {project.name}
      </span>
      <span className="truncate font-mono text-2xs leading-xs text-text-tertiary">
        {tildePath(project.path, home)}
      </span>
    </span>
    <span className="shrink-0 text-xs leading-sm text-text-tertiary">
      {meta}
    </span>
    <span className="flex w-3.5 shrink-0 justify-center">
      {selected ? <CheckIcon size="sm" tone="text" /> : null}
    </span>
  </ListOption>
);

/** LTT: switch projects or start one of the add-project flows. ⌘P opens it. */
export const ProjectPicker = ({
  missions,
  onChange,
  projects,
  value,
}: ProjectPickerProps) => {
  const { openAddProject } = useAddProject();
  const home = useHomeDir();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const selected = projects.find((project) => project.id === value);
  // The current project leads the list, as the most recent one would.
  const filtered = recentProjects(projects, missions, search).toSorted(
    (a, b) => Number(b.id === value) - Number(a.id === value)
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setNow(Date.now());
        setSearch("");
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The add dialog takes focus; returning it to the trigger would pull it back out.
  const handingOff = useRef(false);
  const add = (start: "browse" | "github" | "url") => {
    handingOff.current = true;
    setOpen(false);
    openAddProject(start);
  };
  const onCloseAutoFocus = (event: Event) => {
    if (handingOff.current) {
      handingOff.current = false;
      event.preventDefault();
    }
  };

  return (
    <Popover
      onOpenChange={(next) => {
        setOpen(next);
        setSearch("");
        setNow(Date.now());
      }}
      open={open}
    >
      <PopoverTrigger asChild>
        <PickerButton
          aria-label="Project"
          icon={<FolderIcon />}
          label={selected?.name ?? "Choose a project"}
        />
      </PopoverTrigger>
      <PopoverContent onCloseAutoFocus={onCloseAutoFocus}>
        <PopoverSearch>
          <SearchIcon />
          <input
            aria-label="Search projects"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search projects"
            value={search}
          />
          <Kbd>⌘P</Kbd>
        </PopoverSearch>
        <div className="flex min-h-0 flex-col gap-hairline overflow-y-auto">
          <ListLabel>Recent</ListLabel>
          {filtered.length === 0 ? (
            <p className="px-md py-sm text-xs leading-sm text-text-tertiary">
              No matching projects
            </p>
          ) : (
            <Listbox aria-label="Projects">
              {filtered.map((project) => (
                <ProjectOption
                  home={home}
                  key={project.id}
                  meta={projectMeta(project, missions, now)}
                  onPick={() => {
                    onChange(project.id);
                    setOpen(false);
                  }}
                  project={project}
                  selected={project.id === value}
                />
              ))}
            </Listbox>
          )}
        </div>
        <PopoverSeparator />
        <ListLabel>Add project</ListLabel>
        <ListRow onClick={() => add("browse")}>
          <FolderAddIcon />
          <span className="flex-1">Open local folder…</span>
          <span className="font-mono text-2xs leading-xs text-text-tertiary">
            ⌘O
          </span>
        </ListRow>
        <ListRow onClick={() => add("github")}>
          <GithubIcon />
          <span className="flex-1">Clone from GitHub…</span>
        </ListRow>
        <ListRow onClick={() => add("url")}>
          <LinkIcon />
          <span className="flex-1">Clone from URL…</span>
        </ListRow>
      </PopoverContent>
    </Popover>
  );
};
