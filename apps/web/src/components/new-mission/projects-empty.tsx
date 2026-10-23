"use client";

import {
  CloudDownloadIcon,
  FolderOpenIcon,
  LinkIcon,
  ShieldIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { useAddProject } from "@/components/projects/add-project-context";

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
    className="flex min-w-0 flex-1 cursor-pointer flex-col gap-sm rounded-md bg-surface-raised p-lg text-left shadow-sm transition-colors duration-fast hover:bg-surface-overlay focus-visible:shadow-focus"
    onClick={onSelect}
    type="button"
  >
    <span className="text-text-secondary [&_svg]:size-4">{icon}</span>
    <span className="flex flex-col">
      <span className="type-label text-text">{title}</span>
      <span className="type-caption text-text-tertiary">{description}</span>
    </span>
  </button>
);

/** M5Q: first run, before any project exists. */
export const ProjectsEmpty = () => {
  const { openAddProject } = useAddProject();
  return (
    <div className="flex w-full flex-col gap-lg">
      <div className="flex flex-col gap-md md:flex-row">
        <SourceCard
          description="Any Git repository on this machine"
          icon={<FolderOpenIcon aria-hidden="true" />}
          onSelect={() => openAddProject("browse")}
          title="Open local folder"
        />
        <SourceCard
          description="Pick a repo, cloned into ~/.missions/repos"
          icon={<CloudDownloadIcon aria-hidden="true" />}
          onSelect={() => openAddProject("github")}
          title="Clone from GitHub"
        />
        <SourceCard
          description="Any SSH or HTTPS remote"
          icon={<LinkIcon aria-hidden="true" />}
          onSelect={() => openAddProject("url")}
          title="Clone from URL"
        />
      </div>
      <p className="flex items-center justify-center gap-sm type-caption text-text-tertiary">
        <ShieldIcon aria-hidden="true" className="size-3.5" />
        Droids work in a separate worktree and never push without asking.
      </p>
    </div>
  );
};
