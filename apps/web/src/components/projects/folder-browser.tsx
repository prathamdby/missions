"use client";

import type { Project } from "@missions/protocol/projects";
import { useId, useState } from "react";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import {
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogSection,
  DialogTitle,
} from "@/components/ui/dialog";
import { Dot } from "@/components/ui/dot";
import { IconTile } from "@/components/ui/icon-tile";
import {
  AlertIcon,
  BranchIcon,
  CheckIcon,
  ChevronRightIcon,
  DownloadIcon,
  FolderIcon,
  FolderLibraryIcon,
  FolderOpenIcon,
  TerminalIcon,
} from "@/components/ui/icons";
import type { IconProps } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { ListLabel, ListOption, Listbox } from "@/components/ui/list-row";
import { Switch } from "@/components/ui/selection";
import { Skeleton } from "@/components/ui/skeleton";
import { Hint } from "@/components/ui/tooltip";
import { errorMessage } from "@/lib/api/api-error";
import { useFsBrowse, useProjects } from "@/lib/api/queries";
import { projectLabel, tildePath } from "@/lib/format";

import { joinPath, remoteLabel } from "./clone-target";

interface Place {
  icon: (props: IconProps) => ReactNode;
  name: string;
}

/** Shown when the home folder has them, in Paper's order. */
const PLACES: readonly Place[] = [
  { icon: FolderLibraryIcon, name: "code" },
  { icon: FolderIcon, name: "Desktop" },
  { icon: FolderIcon, name: "Documents" },
  { icon: DownloadIcon, name: "Downloads" },
];

interface Target {
  /** null until the daemon has looked; it reports `not_git` on add. */
  git: boolean | null;
  name: string;
  path: string;
}

const displayPath = (path: string, home: string | null) => {
  const shown = tildePath(path, home);
  return shown.endsWith("/") ? shown : `${shown}/`;
};

const commonPrefix = (names: readonly string[]) => {
  const [first = "", ...rest] = names;
  let end = first.length;
  for (const name of rest) {
    while (
      end > 0 &&
      name.slice(0, end).toLowerCase() !== first.slice(0, end).toLowerCase()
    ) {
      end -= 1;
    }
  }
  return first.slice(0, end);
};

const PathField = ({
  current,
  entries,
  home,
  onGo,
}: {
  current: string;
  entries: readonly { name: string; path: string }[];
  home: string | null;
  onGo: (path: string) => void;
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = displayPath(current, home);
  const value = draft ?? shown;

  const go = (path: string) => {
    setDraft(null);
    onGo(path);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const target = value.trim();
    if (target) {
      go(target);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && draft !== null) {
      event.stopPropagation();
      setDraft(null);
      return;
    }
    if (event.key !== "Tab" || event.shiftKey) {
      return;
    }
    const slash = value.lastIndexOf("/");
    const folder = value.slice(0, slash + 1);
    const partial = value.slice(slash + 1).toLowerCase();
    if (folder !== shown) {
      return;
    }
    const matches = entries.filter((entry) =>
      entry.name.toLowerCase().startsWith(partial)
    );
    const [only] = matches;
    if (matches.length === 1 && only) {
      event.preventDefault();
      go(only.path);
      return;
    }
    const prefix = commonPrefix(matches.map((entry) => entry.name));
    if (prefix.length > partial.length) {
      event.preventDefault();
      setDraft(`${folder}${prefix}`);
    }
  };

  return (
    <form className="flex items-center px-gutter pb-card" onSubmit={onSubmit}>
      <Input
        aria-label="Folder path"
        autoComplete="off"
        leading={<FolderIcon tone="tertiary" />}
        mono
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        spellCheck={false}
        surface="sunken"
        trailing={
          <span className="shrink-0 text-2xs leading-xs font-book tracking-tight text-text-tertiary">
            Tab completes
          </span>
        }
        value={value}
      />
    </form>
  );
};

const Places = ({
  current,
  home,
  onGo,
}: {
  current: string;
  home: string | null;
  onGo: (path: string) => void;
}) => {
  const listing = useFsBrowse(undefined);
  const present = new Set(listing.data?.entries.map((entry) => entry.name));
  const places = PLACES.filter((place) => present.has(place.name));
  if (!home) {
    return null;
  }
  return (
    <div className="flex w-44 shrink-0 flex-col border-r border-border-subtle px-md py-control">
      <ListLabel size="place">Places</ListLabel>
      <Listbox aria-label="Places">
        <ListOption
          onClick={() => onGo(home)}
          selected={current === home}
          size="place"
        >
          <FolderIcon />
          Home
        </ListOption>
        {places.map((place) => {
          const path = joinPath(home, place.name);
          const Icon = place.icon;
          return (
            <ListOption
              key={place.name}
              onClick={() => onGo(path)}
              selected={current === path}
              size="place"
            >
              <Icon />
              {place.name}
            </ListOption>
          );
        })}
      </Listbox>
    </div>
  );
};

const EntryRow = ({
  entry,
  onOpen,
  onPick,
  onSelect,
  project,
  selected,
}: {
  entry: { isGitRepo: boolean; name: string; path: string };
  onOpen: () => void;
  onPick: () => void;
  onSelect: () => void;
  project: Project | undefined;
  selected: boolean;
}) => {
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowRight" && !entry.isGitRepo) {
      event.preventDefault();
      onOpen();
    }
  };
  return (
    <ListOption
      onClick={onSelect}
      onDoubleClick={entry.isGitRepo ? onPick : onOpen}
      onKeyDown={onKeyDown}
      selected={selected}
      size="browser"
    >
      {entry.isGitRepo ? (
        <FolderOpenIcon tone="secondary" />
      ) : (
        <FolderIcon tone="tertiary" />
      )}
      <span
        className={
          entry.isGitRepo
            ? "min-w-0 flex-1 truncate font-medium text-text"
            : "min-w-0 flex-1 truncate"
        }
      >
        {entry.name}
      </span>
      {project ? (
        <Badge size="tag" tone="muted">
          Added
        </Badge>
      ) : null}
      {project?.defaultBranch ? (
        <span className="flex shrink-0 items-center gap-xs text-text-tertiary">
          <BranchIcon size="xs" />
          <span className="font-mono text-2xs leading-xs">
            {project.defaultBranch}
          </span>
        </span>
      ) : null}
      {entry.isGitRepo ? null : <ChevronRightIcon size="sm" tone="tertiary" />}
    </ListOption>
  );
};

const EntriesState = ({ children }: { children: ReactNode }) => (
  <p className="p-md text-xs leading-sm tracking-tight text-text-tertiary">
    {children}
  </p>
);

const BandText = ({ meta, title }: { meta: ReactNode; title: ReactNode }) => (
  <div className="flex min-w-0 flex-1 flex-col gap-2xs">
    <p className="truncate text-sm leading-sm font-medium tracking-tight text-text">
      {title}
    </p>
    <div className="flex min-w-0 items-center gap-md text-xs leading-sm tracking-tight text-text-secondary">
      {meta}
    </div>
  </div>
);

const MonoMeta = ({ children }: { children: ReactNode }) => (
  <span className="min-w-0 truncate font-mono text-2xs leading-xs text-text-tertiary">
    {children}
  </span>
);

const RepoMeta = ({
  home,
  path,
  project,
}: {
  home: string | null;
  path: string;
  project: Project | undefined;
}) => {
  if (!project) {
    return <MonoMeta>{tildePath(path, home)}</MonoMeta>;
  }
  return (
    <>
      {project.defaultBranch ? (
        <span className="flex shrink-0 items-center gap-xs text-text-tertiary">
          <BranchIcon size="xs" />
          <MonoMeta>{project.defaultBranch}</MonoMeta>
        </span>
      ) : null}
      {project.defaultBranch && project.remoteUrl ? (
        <Dot size="separator" />
      ) : null}
      {project.remoteUrl ? (
        <MonoMeta>{remoteLabel(project.remoteUrl)}</MonoMeta>
      ) : null}
      <Dot size="separator" />
      <span className="shrink-0 text-text-tertiary">Already added</span>
    </>
  );
};

const SelectionBand = ({
  home,
  mode,
  onInit,
  pending,
  project,
  repoName,
  target,
}: {
  home: string | null;
  mode: "add" | "choose";
  onInit: () => void;
  pending: boolean;
  project: Project | undefined;
  repoName: string;
  target: Target;
}) => {
  if (mode === "choose") {
    return (
      <DialogSection padding="row">
        <IconTile>
          <FolderIcon size="sm" />
        </IconTile>
        <BandText
          meta={<span>A new folder is created here.</span>}
          title={
            <>
              Clone into{" "}
              <span className="font-mono text-xs">
                {joinPath(tildePath(target.path, home), repoName)}
              </span>
            </>
          }
        />
      </DialogSection>
    );
  }
  if (target.git === false) {
    return (
      <DialogSection padding="row" tone="warning">
        <IconTile tone="warning">
          <AlertIcon size="sm" />
        </IconTile>
        <BandText
          meta={
            <span>
              Missions need Git to create worktrees and track every change.
            </span>
          }
          title={<>{target.name} isn’t a Git repository</>}
        />
        <Button disabled={pending} onClick={onInit} variant="secondary">
          <TerminalIcon size="sm" tone="secondary" />
          {pending ? "Initializing…" : "Initialize Git here"}
        </Button>
      </DialogSection>
    );
  }
  if (target.git) {
    return (
      <DialogSection padding="row">
        <IconTile tone="success">
          <CheckIcon size="sm" />
        </IconTile>
        <BandText
          meta={<RepoMeta home={home} path={target.path} project={project} />}
          title={<>{target.name} is a Git repository</>}
        />
      </DialogSection>
    );
  }
  return (
    <DialogSection padding="row">
      <IconTile>
        <FolderIcon size="sm" />
      </IconTile>
      <BandText
        meta={
          <span className="text-text-tertiary">
            Missions checks for Git when you add it.
          </span>
        }
        title={target.name}
      />
    </DialogSection>
  );
};

const ShowHidden = () => {
  const id = useId();
  return (
    <Hint label="The daemon hides dot-folders for now">
      <span className="flex items-center gap-control">
        <Switch disabled id={id} />
        <label
          className="text-sm leading-sm font-book tracking-tight text-text"
          htmlFor={id}
        >
          Show hidden
        </label>
      </span>
    </Hint>
  );
};

const resolveTarget = (
  entries: readonly { isGitRepo: boolean; name: string; path: string }[],
  selectedPath: string | null,
  current: string,
  notGitPath: string | null
): Target => {
  const selected = entries.find((entry) => entry.path === selectedPath);
  const path = selected?.path ?? current;
  return {
    git: notGitPath === path ? false : (selected?.isGitRepo ?? null),
    name: selected?.name ?? projectLabel(current),
    path,
  };
};

const confirmLabelFor = (mode: "add" | "choose", pending: boolean) => {
  if (mode === "choose") {
    return "Clone here";
  }
  return pending ? "Adding…" : "Add project";
};

const BrowserHeader = ({
  mode,
  repoName,
}: {
  mode: "add" | "choose";
  repoName: string;
}) => (
  <DialogHeader>
    <DialogTitle>
      {mode === "add" ? "Open local folder" : "Choose where to clone"}
    </DialogTitle>
    <DialogDescription>
      {mode === "add"
        ? "Browsing this computer through the Missions daemon. Pick a Git repository."
        : `Missions creates a ${repoName} folder inside the one you pick.`}
    </DialogDescription>
  </DialogHeader>
);

const BrowseState = ({
  browse,
}: {
  browse: ReturnType<typeof useFsBrowse>;
}) => {
  if (browse.isPending) {
    return (
      <div className="flex flex-col gap-md p-md">
        <Skeleton className="w-1/2" />
        <Skeleton className="w-2/3" />
        <Skeleton className="w-1/3" />
      </div>
    );
  }
  if (browse.isError) {
    return <EntriesState>{errorMessage(browse.error)}</EntriesState>;
  }
  if (browse.data.entries.length === 0) {
    return <EntriesState>No folders here.</EntriesState>;
  }
  return null;
};

const BrowserFooter = ({
  blocked,
  confirmLabel,
  mode,
  onCancel,
  onConfirm,
  ready,
}: {
  blocked: boolean;
  confirmLabel: string;
  mode: "add" | "choose";
  onCancel?: () => void;
  onConfirm: () => void;
  ready: boolean;
}) => (
  <DialogFooter>
    {blocked ? (
      <span className="flex min-w-0 items-center gap-sm text-text-tertiary">
        <TerminalIcon size="sm" />
        <span className="truncate font-mono text-2xs leading-xs">git init</span>
      </span>
    ) : null}
    {mode === "add" && !blocked ? <ShowHidden /> : null}
    <span className="flex-1" />
    {onCancel ? (
      <Button onClick={onCancel} variant="ghost">
        Back
      </Button>
    ) : (
      <DialogClose asChild>
        <Button variant="ghost">Cancel</Button>
      </DialogClose>
    )}
    <Button disabled={!ready} onClick={onConfirm} variant="primary">
      {confirmLabel}
    </Button>
  </DialogFooter>
);

interface FolderBrowserProps {
  error: string | null;
  /** `add` picks a project (MHN, MW0); `choose` picks a clone destination. */
  mode: "add" | "choose";
  /** A folder the daemon reported as not a Git repository. */
  notGitPath?: string | null;
  onCancel?: () => void;
  onConfirm: (path: string, initializeGit: boolean) => void;
  pending: boolean;
  repoName?: string;
  startPath?: string;
}

/** MHN and MW0: walk this machine through the daemon and pick a folder. */
export const FolderBrowser = ({
  error,
  mode,
  notGitPath = null,
  onCancel,
  onConfirm,
  pending,
  repoName = "",
  startPath,
}: FolderBrowserProps) => {
  const [path, setPath] = useState<string | undefined>(startPath);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const browse = useFsBrowse(path);
  const home = useFsBrowse(undefined).data?.path ?? null;
  if (browse.isError && startPath !== undefined && path === startPath) {
    // The suggested start folder may not exist yet; fall back to home.
    setPath(undefined);
  }
  const projects = useProjects();
  const current = browse.data?.path ?? "";
  const entries = browse.data?.entries ?? [];
  const byPath = new Map(
    (projects.data ?? []).map((project) => [project.path, project])
  );

  const go = (next: string) => {
    setSelectedPath(null);
    setPath(next);
  };

  const target = resolveTarget(entries, selectedPath, current, notGitPath);
  const blocked = mode === "add" && target.git === false;
  const ready = browse.isSuccess && !pending && !blocked;

  return (
    <>
      <BrowserHeader mode={mode} repoName={repoName} />
      <PathField
        current={current}
        entries={entries}
        home={home}
        key={current}
        onGo={go}
      />
      <DialogSection className="h-82 flex-row">
        <Places current={current} home={home} onGo={go} />
        <div className="min-w-0 flex-1 overflow-y-auto p-md">
          <Listbox aria-label={`Folders in ${tildePath(current, home)}`}>
            <BrowseState browse={browse} />
            {entries.map((entry) => (
              <EntryRow
                entry={entry}
                key={entry.path}
                onOpen={() => go(entry.path)}
                onPick={() => onConfirm(entry.path, false)}
                onSelect={() => setSelectedPath(entry.path)}
                project={byPath.get(entry.path)}
                selected={entry.path === selectedPath}
              />
            ))}
          </Listbox>
        </div>
      </DialogSection>
      {browse.isSuccess ? (
        <SelectionBand
          home={home}
          mode={mode}
          onInit={() => onConfirm(target.path, true)}
          pending={pending}
          project={byPath.get(target.path)}
          repoName={repoName}
          target={target}
        />
      ) : null}
      {error ? (
        <DialogSection padding="row">
          <Callout
            appearance="filled"
            role="alert"
            title={error}
            tone="danger"
          />
        </DialogSection>
      ) : null}
      <BrowserFooter
        blocked={blocked}
        confirmLabel={confirmLabelFor(mode, pending)}
        mode={mode}
        onCancel={onCancel}
        onConfirm={() => onConfirm(target.path, false)}
        ready={ready}
      />
    </>
  );
};
