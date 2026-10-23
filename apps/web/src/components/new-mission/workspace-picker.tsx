"use client";

import type { WorktreeInfo } from "@missions/protocol/workspaces";
import {
  CheckIcon,
  FolderIcon,
  LaptopIcon,
  LayersIcon,
  SettingsIcon,
} from "lucide-react";
import Link from "next/link";

import { PickerButton } from "@/components/new-mission/picker-button";
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
  MenuItemText,
} from "@/components/ui/dropdown-menu";

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
  onChange: (choice: WorkspaceChoice) => void;
  value: WorkspaceChoice;
  worktreeRoot: string | null;
  worktrees: readonly WorktreeInfo[];
}

const worktreeName = (path: string) =>
  path.split(/[/\\]/u).findLast(Boolean) ?? path;

/** PNO: where the droids work. */
export const WorkspacePicker = ({
  canWorktree,
  checkoutPath,
  onChange,
  value,
  worktreeRoot,
  worktrees,
}: WorkspacePickerProps) => {
  const icon =
    value.mode === "current_checkout" ? (
      <FolderIcon aria-hidden="true" />
    ) : (
      <LaptopIcon aria-hidden="true" />
    );
  const label =
    value.mode === "existing_worktree"
      ? worktreeName(value.path)
      : LABEL[value.mode];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <PickerButton aria-label="Workspace" icon={icon} label={label} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-96">
        <DropdownMenuRadioGroup
          onValueChange={(mode) => {
            if (mode === "new_worktree" || mode === "current_checkout") {
              onChange({ mode });
            }
          }}
          value={value.mode}
        >
          <DropdownMenuRadioItem disabled={!canWorktree} value="new_worktree">
            <LaptopIcon aria-hidden="true" />
            <MenuItemText
              description={
                canWorktree
                  ? "An isolated copy on a new branch. Your files stay untouched."
                  : "Needs a Git repository with at least one commit."
              }
              label="New worktree"
              meta={
                <Badge size="sm" tone="muted">
                  Recommended
                </Badge>
              }
            />
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="current_checkout">
            <FolderIcon aria-hidden="true" />
            <MenuItemText
              description={`Edits ${checkoutPath} directly, on the branch you have checked out.`}
              label="Current checkout"
              meta={
                <Badge size="sm" tone="warning">
                  Changes your files
                </Badge>
              }
            />
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        {worktrees.length > 0 ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <LayersIcon aria-hidden="true" />
              <MenuItemText
                description="Continue in a worktree an earlier mission left behind."
                label="Existing worktree…"
              />
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuLabel>Worktrees</DropdownMenuLabel>
              {worktrees.map((worktree) => (
                <DropdownMenuItem
                  key={worktree.path}
                  onSelect={() =>
                    onChange({ mode: "existing_worktree", path: worktree.path })
                  }
                >
                  <MenuItemText
                    description={worktree.path}
                    label={worktree.branch ?? worktreeName(worktree.path)}
                    meta={
                      worktree.dirty ? (
                        <Badge size="sm" tone="warning">
                          uncommitted
                        </Badge>
                      ) : undefined
                    }
                  />
                  {value.mode === "existing_worktree" &&
                  value.path === worktree.path ? (
                    <CheckIcon aria-hidden="true" />
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
        {worktreeRoot ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings">
                <SettingsIcon aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate type-caption text-text-tertiary">
                  Worktrees live in{" "}
                  <span className="font-mono">{worktreeRoot}</span>
                </span>
                <span className="type-caption text-text">Change</span>
              </Link>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
