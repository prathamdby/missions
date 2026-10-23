"use client";

import type { Project } from "@missions/protocol/projects";
import { CircleCheckIcon } from "lucide-react";

import { Tag } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface ProjectAddedProps {
  onAddAnother: () => void;
  onStartMission: () => void;
  project: Project;
}

/** OZS: confirmation with the next step front and center. */
export const ProjectAdded = ({
  onAddAnother,
  onStartMission,
  project,
}: ProjectAddedProps) => (
  <div className="flex flex-col gap-lg">
    <div className="flex gap-lg">
      <CircleCheckIcon
        aria-hidden="true"
        className="mt-2xs size-5 shrink-0 text-success"
      />
      <div className="flex min-w-0 flex-col gap-sm">
        <p className="type-body text-text">
          <span className="font-medium">{project.name}</span> is ready for
          missions.
        </p>
        <p className="font-mono text-xs break-all text-text-secondary">
          {project.path}
        </p>
        <div className="flex flex-wrap gap-sm">
          {project.defaultBranch ? <Tag>{project.defaultBranch}</Tag> : null}
          {project.remoteUrl ? <Tag>{project.remoteUrl}</Tag> : null}
        </div>
      </div>
    </div>
    <div className="flex flex-wrap justify-end gap-md">
      <Button onClick={onAddAnother} variant="ghost">
        Add another
      </Button>
      <Button onClick={onStartMission} variant="primary">
        Start a mission
      </Button>
    </div>
  </div>
);
