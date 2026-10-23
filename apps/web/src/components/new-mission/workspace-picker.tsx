"use client";

import type { WorktreeInfo } from "@missions/protocol/workspaces";
import Link from "next/link";
import type { ReactNode } from "react";

import { PickerButton } from "@/components/new-mission/picker-button";
import { PickerRow } from "@/components/new-mission/picker-row";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CheckIcon,
  FolderIcon,
  LaptopIcon,
  LayersIcon,
  SettingsIcon,
} from "@/components/ui/icons";
import { tildePath } from "@/lib/format";

export type WorkspaceChoice =
  | { mode: "current_checkout" }
  | { mode: "existing_worktree"; path: string }
  | { mode: "new_worktree" };

const LABEL = {
  current_checkout: "Current checkout",
  existing_worktree: "Existing worktree",
  new_worktree: "New worktree",
} as const;

interface WorkspacePickerProps {
  canWorktree: boolean;
  checkoutPath: string;
  home: string | null;
  /** `row` renders the trigger as a grouped-card row (YL0). */
  layout?: "button" | "row";
  onChange: (choice: WorkspaceChoice) => void;
  value: WorkspaceChoice;
  worktreeRoot: string | null;
  worktrees: readonly WorktreeInfo[];
}

const worktreeName = (path: string) =>
  path.split(/[/\\]/u).findLast(Boolean) ?? path;

/** Title, optional tag, and a description line, as in PNO. */
const ChoiceText = ({
  description,
  tag,
  title,
}: {
  description: string;
  tag?: ReactNode;
  title: string;
}) => (
  <span className="flex min-w-0 flex-1 flex-col gap-stack">
    <span className="flex items-center gap-md font-medium">
      {title}
      {tag}
    </span>
    <span className="text-xs leading-sm text-text-tertiary">{description}</span>
  </span>
);

/** PNO: where the droids work. */
export const WorkspacePicker = ({
  canWorktree,
  checkoutPath,
  home,
  layout = "button",
  onChange,
  value,
  worktreeRoot,
  worktrees,
}: WorkspacePickerProps) => {
  const icon =
    value.mode === "current_checkout" ? <FolderIcon /> : <LaptopIcon />;
  const label =
    value.mode === "existing_worktree"
      ? worktreeName(value.path)
      : LABEL[value.mode];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {layout === "row" ? (
          <PickerRow
            aria-label="Workspace"
            icon={icon}
            label="Worktree"
            value={label}
          />
        ) : (
          <PickerButton aria-label="Workspace" icon={icon} label={label} />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-100">
        <DropdownMenuRadioGroup
          onValueChange={(mode) => {
            if (mode === "new_worktree" || mode === "current_checkout") {
              onChange({ mode });
            }
          }}
          value={value.mode}
        >
          <DropdownMenuRadioItem
            disabled={!canWorktree}
            size="option"
            value="new_worktree"
          >
            <LaptopIcon className="mt-hairline" />
            <ChoiceText
              description={
                canWorktree
                  ? "An isolated copy on a new branch. Your files stay untouched."
                  : "Needs a Git repository with at least one commit."
              }
              tag={
                <Badge size="tag" tone="muted">
                  Recommended
                </Badge>
              }
              title="New worktree"
            />
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem size="option" value="current_checkout">
            <FolderIcon className="mt-hairline" />
            <ChoiceText
              description={`Edits ${tildePath(checkoutPath, home)} directly, on the branch you have checked out.`}
              tag={
                <Badge size="tag" tone="warning">
                  Changes your files
                </Badge>
              }
              title="Current checkout"
            />
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger
            disabled={worktrees.length === 0}
            size="option"
          >
            <LayersIcon className="mt-hairline" />
            <ChoiceText
              description={
                worktrees.length > 0
                  ? "Continue in a worktree an earlier mission left behind."
                  : "No other worktrees in this repository yet."
              }
              title="Existing worktree…"
            />
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-90">
            <DropdownMenuLabel>Worktrees</DropdownMenuLabel>
            {worktrees.map((worktree) => (
              <DropdownMenuItem
                key={worktree.path}
                onSelect={() =>
                  onChange({ mode: "existing_worktree", path: worktree.path })
                }
                size="option"
              >
                <LayersIcon className="mt-hairline" />
                <ChoiceText
                  description={tildePath(worktree.path, home)}
                  tag={
                    worktree.dirty ? (
                      <Badge size="tag" tone="warning">
                        Uncommitted
                      </Badge>
                    ) : undefined
                  }
                  title={worktree.branch ?? worktreeName(worktree.path)}
                />
                <span className="flex w-3.5 shrink-0 justify-center pt-hairline">
                  {value.mode === "existing_worktree" &&
                  value.path === worktree.path ? (
                    <CheckIcon size="sm" tone="text" />
                  ) : null}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {worktreeRoot ? (
          <>
            <DropdownMenuSeparator />
            <div className="flex items-center gap-md p-md text-xs leading-sm">
              <SettingsIcon size="sm" tone="tertiary" />
              <span className="text-text-tertiary">Worktrees live in</span>
              <span className="min-w-0 flex-1 truncate font-mono text-2xs leading-xs text-text-secondary">
                {tildePath(worktreeRoot, home)}
              </span>
              <Link
                className="font-medium text-text-secondary hover:text-text"
                href="/settings"
              >
                Change
              </Link>
            </div>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
