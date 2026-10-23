"use client";

import type { Branch } from "@missions/protocol/projects";
import { useRef, useState } from "react";

import { PickerButton } from "@/components/new-mission/picker-button";
import { PickerRow } from "@/components/new-mission/picker-row";
import { Badge } from "@/components/ui/badge";
import {
  BranchIcon,
  CheckIcon,
  PlusIcon,
  SearchIcon,
} from "@/components/ui/icons";
import {
  ListLabel,
  ListOption,
  ListRow,
  Listbox,
} from "@/components/ui/list-row";
import {
  Popover,
  PopoverContent,
  PopoverNote,
  PopoverSearch,
  PopoverSeparator,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api/api-error";
import { useBranches } from "@/lib/api/queries";
import { cn } from "@/lib/utils";

interface BranchPickerProps {
  /** Branches already checked out by other worktrees. */
  busy: readonly string[];
  defaultBranch: string | null;
  /** `row` renders the trigger as a grouped-card row (YL0). */
  layout?: "button" | "row";
  /** Name for the mission's new branch, when the user typed one. */
  newBranch: string | null;
  onChange: (branch: string) => void;
  onCreate: (name: string | null) => void;
  projectId: string;
  value: string | null;
}

const BranchOption = ({
  branch,
  busy,
  isDefault,
  onPick,
  selected,
}: {
  branch: Branch;
  busy: boolean;
  isDefault: boolean;
  onPick: () => void;
  selected: boolean;
}) => (
  <ListOption onClick={onPick} selected={selected}>
    <BranchIcon size="sm" />
    <span
      className={cn(
        "min-w-0 flex-1 truncate font-mono text-xs leading-sm group-hover/list-row:text-text",
        selected || isDefault ? "text-text" : "text-text-secondary"
      )}
    >
      {branch.name}
    </span>
    {isDefault ? (
      <Badge size="tag" tone="muted">
        Default
      </Badge>
    ) : null}
    {busy ? (
      <Badge size="tag" tone="accent-plain">
        In a mission
      </Badge>
    ) : null}
    <span className="flex w-3.5 shrink-0 justify-center">
      {selected ? <CheckIcon size="sm" tone="text" /> : null}
    </span>
  </ListOption>
);

const BranchGroup = ({
  branches,
  busy,
  defaultBranch,
  label,
  onPick,
  value,
}: {
  branches: readonly Branch[];
  busy: readonly string[];
  defaultBranch: string | null;
  label: string;
  onPick: (name: string) => void;
  value: string | null;
}) =>
  branches.length === 0 ? null : (
    <>
      <ListLabel>{label}</ListLabel>
      <Listbox aria-label={`${label} branches`}>
        {branches.map((branch) => (
          <BranchOption
            branch={branch}
            busy={busy.includes(branch.name)}
            isDefault={branch.name === defaultBranch}
            key={`${label}:${branch.name}`}
            onPick={() => onPick(branch.name)}
            selected={branch.name === value}
          />
        ))}
      </Listbox>
    </>
  );

/** Default first, then the rest in the daemon's order. */
const ordered = (branches: readonly Branch[], defaultBranch: string | null) =>
  branches.toSorted(
    (a, b) =>
      Number(b.name === defaultBranch) - Number(a.name === defaultBranch)
  );

/** PB7: the base branch a new worktree starts from, or a new branch name. */
export const BranchPicker = ({
  busy,
  defaultBranch,
  layout = "button",
  newBranch,
  onChange,
  onCreate,
  projectId,
  value,
}: BranchPickerProps) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const branches = useBranches(projectId);
  const needle = search.trim();
  const filtered = ordered(branches.data ?? [], defaultBranch).filter(
    (branch) =>
      !needle || branch.name.toLowerCase().includes(needle.toLowerCase())
  );
  const exact = (branches.data ?? []).find((branch) => branch.name === needle);
  const base = value ?? defaultBranch ?? "main";

  const pick = (name: string) => {
    onChange(name);
    onCreate(null);
    setOpen(false);
  };

  const create = () => {
    if (!needle || exact) {
      searchRef.current?.focus();
      return;
    }
    onCreate(needle);
    setOpen(false);
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
        {layout === "row" ? (
          <PickerRow
            aria-label="Base branch"
            icon={<BranchIcon />}
            label="Branch"
            value={newBranch ?? value ?? "Choose"}
          />
        ) : (
          <PickerButton
            aria-label="Base branch"
            icon={<BranchIcon />}
            label={newBranch ?? value ?? "Branch"}
          />
        )}
      </PopoverTrigger>
      <PopoverContent size="sm">
        <PopoverSearch inset="lg">
          <SearchIcon />
          <input
            aria-label="Search or create a branch"
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                const first = exact ?? filtered[0];
                if (first && (exact || !needle)) {
                  pick(first.name);
                } else {
                  create();
                }
              }
            }}
            placeholder="Search or create a branch"
            ref={searchRef}
            value={search}
          />
        </PopoverSearch>
        <div className="flex min-h-0 flex-col gap-hairline overflow-y-auto">
          {branches.isPending ? (
            <div className="flex flex-col gap-md p-md">
              <Skeleton className="w-1/2" />
              <Skeleton className="w-2/3" />
            </div>
          ) : null}
          {branches.isError ? (
            <p className="p-md text-xs leading-sm text-danger">
              {errorMessage(branches.error)}
            </p>
          ) : null}
          <BranchGroup
            branches={filtered.filter((branch) => !branch.remote)}
            busy={busy}
            defaultBranch={defaultBranch}
            label="Local"
            onPick={pick}
            value={newBranch ? null : value}
          />
          <BranchGroup
            branches={filtered.filter((branch) => branch.remote)}
            busy={busy}
            defaultBranch={defaultBranch}
            label="Remote"
            onPick={pick}
            value={newBranch ? null : value}
          />
        </div>
        <PopoverSeparator />
        <ListRow onClick={create}>
          <PlusIcon />
          <span className="min-w-0 flex-1 truncate">
            {needle && !exact
              ? `Create “${needle}” from ${base}`
              : `Create branch from ${base}…`}
          </span>
        </ListRow>
        <PopoverNote>
          Missions branch off this base. Your checkout stays where it is.
        </PopoverNote>
      </PopoverContent>
    </Popover>
  );
};
