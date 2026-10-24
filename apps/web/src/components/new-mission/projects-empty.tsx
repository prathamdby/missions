"use client";

import type { ReactNode } from "react";

import { useAddProject } from "@/components/projects/add-project-context";
import {
  FolderAddIcon,
  GithubIcon,
  LinkIcon,
  ShieldIcon,
} from "@/components/ui/icons";

const SourceCard = ({
  description,
  icon,
  onSelect,
  title,
}: {
  description: string;
  icon: ReactNode;
  onSelect: () => void;
  title: string;
}) => (
  <button
    className="flex min-w-0 flex-1 cursor-pointer flex-col gap-control rounded-md bg-surface-raised p-card text-left shadow-sm transition-colors duration-fast outline-none hover:bg-surface-overlay focus-visible:shadow-focus"
    onClick={onSelect}
    type="button"
  >
    <span className="flex h-5 shrink-0 items-center text-text">{icon}</span>
    <span className="flex flex-col gap-2xs tracking-tight">
      <span className="text-sm leading-sm font-medium text-text">{title}</span>
      <span className="text-xs leading-sm text-text-tertiary">
        {description}
      </span>
    </span>
  </button>
);

/** M5Q: first run, before any project exists. */
export const ProjectsEmpty = () => {
  const { openAddProject } = useAddProject();
  return (
    <div className="flex w-full max-w-chat flex-col gap-lg">
      <div className="flex flex-col gap-md md:flex-row">
        <SourceCard
          description="Any Git repository on this machine"
          icon={<FolderAddIcon />}
          onSelect={() => openAddProject("browse")}
          title="Open local folder"
        />
        <SourceCard
          description="Pick one of your repos to clone"
          icon={<GithubIcon />}
          onSelect={() => openAddProject("github")}
          title="Clone from GitHub"
        />
        <SourceCard
          description="Any SSH or HTTPS remote"
          icon={<LinkIcon />}
          onSelect={() => openAddProject("url")}
          title="Clone from URL"
        />
      </div>
      <p className="flex items-center justify-center gap-sm text-xs leading-sm tracking-tight text-text-tertiary">
        <ShieldIcon size="sm" />
        Droids work in a separate worktree and never push without asking.
      </p>
    </div>
  );
};
