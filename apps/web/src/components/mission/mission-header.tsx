"use client";

import { PanelRightIcon, PauseIcon, PlayIcon } from "lucide-react";

import { useMission } from "@/components/mission/mission-context";
import { useMissionControl } from "@/components/mission/use-mission-control";
import { PageHeader, PageTitle } from "@/components/shell/page-header";
import { Badge, Tag } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { useProjects } from "@/lib/api/queries";
import {
  canPause,
  canResume,
  formatDuration,
  isMissionActive,
  MISSION_STATUS,
} from "@/lib/format";
import { useNow } from "@/lib/use-now";

const Timer = ({ since }: { since: string }) => {
  const now = useNow();
  return (
    <span className="hidden font-mono text-xs text-text-tertiary tabular-nums sm:inline">
      {formatDuration(now - Date.parse(since))}
    </span>
  );
};

const ControlButton = () => {
  const { live } = useMission();
  const { pause, pausing, resume, resuming } = useMissionControl();
  const { status } = live.mission;
  if (canPause(status)) {
    return (
      <Button disabled={pausing} onClick={pause} variant="secondary">
        <PauseIcon aria-hidden="true" />
        {pausing ? "Pausing…" : "Pause"}
      </Button>
    );
  }
  if (canResume(status)) {
    return (
      <Button disabled={resuming} onClick={resume} variant="secondary">
        <PlayIcon aria-hidden="true" />
        {resuming ? "Resuming…" : "Resume"}
      </Button>
    );
  }
  return null;
};

export const MissionHeader = ({
  onTogglePanel,
}: {
  onTogglePanel: () => void;
}) => {
  const { live } = useMission();
  const { mission } = live;
  const projects = useProjects();
  const project = projects.data?.find(
    (entry) => entry.id === mission.projectId
  );
  const status = MISSION_STATUS[mission.status];
  return (
    <PageHeader>
      <PageTitle>{mission.title}</PageTitle>
      <Badge dot tone={status.tone}>
        {status.label}
      </Badge>
      {project ? (
        <Tag className="hidden md:inline-flex">{project.name}</Tag>
      ) : null}
      <span className="flex-1" />
      {isMissionActive(mission.status) ? (
        <Timer since={mission.createdAt} />
      ) : null}
      <ControlButton />
      <IconButton
        icon={<PanelRightIcon />}
        label="Toggle details panel"
        onClick={onTogglePanel}
      />
    </PageHeader>
  );
};
