"use client";

import type { ReactNode } from "react";

import { ConnectionBanner } from "@/components/shell/connection-banner";
import { PageHeader, PageTitle } from "@/components/shell/page-header";
import { Tag } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useConnectionStatus, useSettings } from "@/lib/api/queries";
import { AUTONOMY } from "@/lib/autonomy";
import { cn } from "@/lib/utils";

const Group = ({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: string;
  title: string;
}) => (
  <section aria-label={title} className="flex flex-col gap-md">
    <div className="flex flex-col gap-2xs">
      <h2 className="type-label text-text">{title}</h2>
      <p className="type-caption text-text-tertiary">{description}</p>
    </div>
    <div className="flex flex-col divide-y divide-border-subtle rounded-md bg-surface-raised shadow-sm">
      {children}
    </div>
  </section>
);

const Row = ({
  description,
  label,
  value,
}: {
  description: string;
  label: string;
  value: ReactNode;
}) => (
  <div className="flex flex-wrap items-center gap-md px-lg py-md">
    <div className="flex min-w-0 flex-1 flex-col">
      <span className="type-label text-text">{label}</span>
      <span className="type-caption text-text-tertiary">{description}</span>
    </div>
    <div className="flex items-center gap-sm">{value}</div>
  </div>
);

const Status = ({ label, ok }: { label: string; ok: boolean }) => (
  <span className="flex items-center gap-sm type-caption text-text-secondary">
    <span
      aria-hidden="true"
      className={cn("size-1.5 rounded-full", ok ? "bg-success" : "bg-warning")}
    />
    {label}
  </span>
);

const modelText = (model: {
  modelId: string;
  reasoningEffort: string | null;
}) =>
  model.reasoningEffort
    ? `${model.modelId} · ${model.reasoningEffort}`
    : model.modelId;

const SettingsGroups = () => {
  const settings = useSettings();
  const connection = useConnectionStatus();
  if (settings.isPending) {
    return (
      <div className="flex flex-col gap-md">
        <Skeleton className="w-1/3" />
        <Skeleton className="h-24" />
      </div>
    );
  }
  if (settings.isError) {
    return (
      <p className="type-caption text-text-tertiary">
        Settings load once the Missions daemon is reachable.
      </p>
    );
  }
  const { data } = settings;
  return (
    <>
      <Group description="New missions start with these models." title="Models">
        <Row
          description="Plans the mission, splits it into todos, and talks to you."
          label="Orchestrator"
          value={<Tag>{modelText(data.orchestrator)}</Tag>}
        />
        <Row
          description="Do the todos in the mission's workspace."
          label="Workers"
          value={<Tag>{modelText(data.worker)}</Tag>}
        />
        <Row
          description="How many workers may run at the same time."
          label="Concurrent workers"
          value={<Tag>{data.maxConcurrentWorkers}</Tag>}
        />
      </Group>
      <Group
        description="What droids can run without asking. ⇧Tab changes it for one mission."
        title="Autonomy"
      >
        <Row
          description={AUTONOMY[data.defaultAutonomy].scope}
          label="Default level"
          value={<Tag>{AUTONOMY[data.defaultAutonomy].label}</Tag>}
        />
      </Group>
      <Group
        description="Each mission can work in its own Git worktree so your checkout stays untouched."
        title="Worktrees"
      >
        <Row
          description="Where the daemon creates worktrees on this machine."
          label="Location"
          value={<Tag>{data.worktreeRoot}</Tag>}
        />
        <Row
          description="Remove the worktree and local branch after the pull request merges."
          label="Delete worktree when merged"
          value={<Tag>{data.cleanupAfterMerge ? "On" : "Off"}</Tag>}
        />
      </Group>
      {connection.data ? (
        <Group
          description="The web app only talks to the daemon. The daemon uses this machine's credentials."
          title="Connections"
        >
          <Row
            description="Runs missions, Git, and gh on this machine."
            label="Daemon"
            value={
              <Status
                label={`Connected · v${connection.data.daemon.version}`}
                ok
              />
            }
          />
          <Row
            description="Runs the agents."
            label="Droid"
            value={
              <Status
                label={
                  connection.data.droid.message ?? connection.data.droid.state
                }
                ok={connection.data.droid.state === "ready"}
              />
            }
          />
          <Row
            description="Uses the gh CLI login to clone, push, and open pull requests."
            label="GitHub"
            value={
              <Status
                label={
                  connection.data.github.user
                    ? `Signed in as ${connection.data.github.user}`
                    : (connection.data.github.message ??
                      connection.data.github.state)
                }
                ok={connection.data.github.state === "signed_in"}
              />
            }
          />
        </Group>
      ) : null}
      <p className="type-caption text-text-tertiary">
        Editing settings from the web app arrives in a later milestone.
      </p>
    </>
  );
};

export const SettingsView = () => (
  <div className="relative flex min-w-0 flex-1 flex-col">
    <PageHeader>
      <PageTitle>Settings</PageTitle>
    </PageHeader>
    <ConnectionBanner />
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-chat flex-col gap-2xl px-lg py-xl md:px-xl">
        <SettingsGroups />
      </div>
    </div>
  </div>
);
