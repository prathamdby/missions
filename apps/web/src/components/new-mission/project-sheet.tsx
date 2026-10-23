"use client";

import type { MissionSummary } from "@missions/protocol/missions";
import type { Project } from "@missions/protocol/projects";
import type { ReactNode } from "react";
import { useRef, useState } from "react";

import { PickerRow } from "@/components/new-mission/picker-row";
import {
  projectMeta,
  recentProjects,
} from "@/components/new-mission/project-list";
import { useAddProject } from "@/components/projects/add-project-context";
import { useHomeDir } from "@/components/projects/use-home-dir";
import {
  CheckIcon,
  ChevronRightIcon,
  FolderAddIcon,
  FolderIcon,
  GithubIcon,
  LinkIcon,
  SearchIcon,
} from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import {
  ListLabel,
  ListOption,
  ListRow,
  Listbox,
} from "@/components/ui/list-row";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useGithubAuth } from "@/lib/api/queries";
import { tildePath } from "@/lib/format";

const SourceRow = ({
  description,
  icon,
  onSelect,
  title,
}: {
  description?: string;
  icon: ReactNode;
  onSelect: () => void;
  title: string;
}) => (
  <ListRow onClick={onSelect} size="sheet-action">
    {icon}
    <span className="flex min-w-0 flex-1 flex-col gap-hairline">
      <span className="truncate">{title}</span>
      {description ? (
        <span className="truncate text-xs leading-sm font-book text-text-tertiary">
          {description}
        </span>
      ) : null}
    </span>
    <ChevronRightIcon tone="tertiary" />
  </ListRow>
);

/** YWG: the project picker as a bottom sheet on touch screens. */
export const ProjectSheet = ({
  missions,
  onChange,
  projects,
  value,
}: {
  missions: readonly MissionSummary[];
  onChange: (projectId: string) => void;
  projects: readonly Project[];
  value: string | null;
}) => {
  const { openAddProject } = useAddProject();
  const home = useHomeDir();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const auth = useGithubAuth(open);
  const selected = projects.find((project) => project.id === value);
  const list = recentProjects(projects, missions, search).toSorted(
    (a, b) => Number(b.id === value) - Number(a.id === value)
  );

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
    <Sheet
      onOpenChange={(next) => {
        setOpen(next);
        setSearch("");
        setNow(Date.now());
      }}
      open={open}
    >
      <SheetTrigger asChild>
        <PickerRow
          aria-label="Project"
          icon={<FolderIcon />}
          label="Project"
          value={selected?.name ?? "Choose"}
        />
      </SheetTrigger>
      <SheetContent
        aria-describedby={undefined}
        onCloseAutoFocus={onCloseAutoFocus}
        side="bottom"
      >
        <div className="flex h-8 shrink-0 items-center pr-md pl-lg">
          <SheetTitle asChild>
            <h2 className="flex-1 text-base leading-sm font-semibold tracking-tight text-text">
              Choose a project
            </h2>
          </SheetTitle>
          <SheetClose asChild>
            <button
              className="cursor-pointer rounded-xs text-sm leading-sm font-medium tracking-tight text-text-secondary outline-none hover:text-text focus-visible:shadow-focus"
              type="button"
            >
              Cancel
            </button>
          </SheetClose>
        </div>
        <div className="shrink-0 px-xs pt-control pb-sm">
          <Input
            aria-label="Search projects"
            leading={<SearchIcon />}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search projects"
            size="touch"
            value={search}
          />
        </div>
        <div className="flex min-h-0 flex-col overflow-y-auto">
          <ListLabel size="sheet">Recent</ListLabel>
          <Listbox aria-label="Projects">
            {list.map((project) => {
              const isSelected = project.id === value;
              return (
                <ListOption
                  key={project.id}
                  onClick={() => {
                    onChange(project.id);
                    setOpen(false);
                  }}
                  selected={isSelected}
                  size="sheet"
                >
                  <FolderIcon />
                  <span className="flex min-w-0 flex-1 flex-col gap-2xs">
                    <span className="truncate font-medium">{project.name}</span>
                    <span className="truncate font-mono text-xs leading-sm text-text-tertiary">
                      {tildePath(project.path, home)}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs leading-sm text-text-tertiary">
                    {projectMeta(project, missions, now)}
                  </span>
                  {isSelected ? <CheckIcon tone="text" /> : null}
                </ListOption>
              );
            })}
          </Listbox>
        </div>
        <hr className="-mx-md my-md h-px shrink-0 border-0 bg-border-subtle" />
        <ListLabel size="sheet">Add project</ListLabel>
        <SourceRow
          description="Browse this machine"
          icon={<FolderAddIcon />}
          onSelect={() => add("browse")}
          title="Open local folder"
        />
        <SourceRow
          description={
            auth.data?.state === "signed_in" ? "Signed in with gh" : undefined
          }
          icon={<GithubIcon />}
          onSelect={() => add("github")}
          title="Clone from GitHub"
        />
        <SourceRow
          icon={<LinkIcon />}
          onSelect={() => add("url")}
          title="Clone from URL"
        />
      </SheetContent>
    </Sheet>
  );
};
