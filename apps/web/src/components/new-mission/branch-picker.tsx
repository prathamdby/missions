"use client";

import type { Branch } from "@missions/protocol/projects";
import { CheckIcon, GitBranchIcon, SearchIcon } from "lucide-react";
import { useState } from "react";

import { PickerButton } from "@/components/new-mission/picker-button";
import { Tag } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ListLabel, ListRow } from "@/components/ui/list-row";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api/api-error";
import { useBranches } from "@/lib/api/queries";

interface BranchPickerProps {
  onChange: (branch: string) => void;
  projectId: string;
  value: string | null;
}

const BranchRows = ({
  branches,
  label,
  onPick,
  value,
}: {
  branches: Branch[];
  label: string;
  onPick: (name: string) => void;
  value: string | null;
}) =>
  branches.length === 0 ? null : (
    <>
      <ListLabel>{label}</ListLabel>
      {branches.map((branch) => (
        <ListRow
          aria-pressed={branch.name === value}
          key={`${label}:${branch.name}`}
          onClick={() => onPick(branch.name)}
        >
          <GitBranchIcon aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate font-mono text-xs">
            {branch.name}
          </span>
          {branch.current ? <Tag>checked out</Tag> : null}
          {branch.name === value ? (
            <CheckIcon aria-hidden="true" />
          ) : (
            <span aria-hidden="true" className="size-4" />
          )}
        </ListRow>
      ))}
    </>
  );

/** PB7: the base branch a new worktree starts from. */
export const BranchPicker = ({
  onChange,
  projectId,
  value,
}: BranchPickerProps) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const branches = useBranches(projectId);
  const needle = search.trim().toLowerCase();
  const filtered = (branches.data ?? []).filter(
    (branch) => !needle || branch.name.toLowerCase().includes(needle)
  );

  const pick = (name: string) => {
    onChange(name);
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
        <PickerButton
          aria-label="Base branch"
          icon={<GitBranchIcon aria-hidden="true" />}
          label={value ?? "Branch"}
        />
      </PopoverTrigger>
      <PopoverContent>
        <div className="border-b border-border-subtle p-sm">
          <Input
            aria-label="Search branches"
            leading={<SearchIcon aria-hidden="true" />}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search branches"
            value={search}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-xs">
          {branches.isPending ? (
            <div className="flex flex-col gap-md p-md">
              <Skeleton className="w-1/2" />
              <Skeleton className="w-2/3" />
            </div>
          ) : null}
          {branches.isError ? (
            <p className="p-md type-caption text-danger">
              {errorMessage(branches.error)}
            </p>
          ) : null}
          {branches.isSuccess && filtered.length === 0 ? (
            <p className="p-md type-caption text-text-tertiary">
              No matching branches
            </p>
          ) : null}
          <BranchRows
            branches={filtered.filter((branch) => !branch.remote)}
            label="Local"
            onPick={pick}
            value={value}
          />
          <BranchRows
            branches={filtered.filter((branch) => branch.remote)}
            label="Remote"
            onPick={pick}
            value={value}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
};
