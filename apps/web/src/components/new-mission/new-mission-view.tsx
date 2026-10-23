"use client";

import type { MissionSummary } from "@missions/protocol/missions";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUpIcon, LaptopIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import type { FormEvent, KeyboardEvent } from "react";

import { AutonomyChip } from "@/components/missions/autonomy-chip";
import {
  ComposerFrame,
  ComposerHints,
} from "@/components/missions/composer-frame";
import { BranchPicker } from "@/components/new-mission/branch-picker";
import { ModelPicker } from "@/components/new-mission/model-picker";
import { ProjectPicker } from "@/components/new-mission/project-picker";
import { ProjectsEmpty } from "@/components/new-mission/projects-empty";
import { useNewMissionForm } from "@/components/new-mission/use-new-mission-form";
import type { NewMissionForm } from "@/components/new-mission/use-new-mission-form";
import { WorkspacePicker } from "@/components/new-mission/workspace-picker";
import { ConnectionBanner } from "@/components/shell/connection-banner";
import { PageHeader, PageTitle } from "@/components/shell/page-header";
import { Button, IconButton } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Textarea } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api/api-error";
import { api } from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/query-keys";
import { useOperationIds } from "@/lib/api/use-operation";
import { nextAutonomy } from "@/lib/autonomy";
import { upsertById } from "@/lib/live/global-cache";
import { cn } from "@/lib/utils";

const Wordmark = () => (
  <p
    aria-hidden="true"
    className="flex items-center gap-md type-display text-text"
  >
    <span className="size-5 rounded-xs bg-accent" />
    Missions
  </p>
);

const CheckoutLine = ({ form }: { form: NewMissionForm }) => {
  const { checkout, dirtyCount, project, workspace } = form;
  if (!project) {
    return null;
  }
  const path =
    workspace.mode === "existing_worktree" ? workspace.path : project.path;
  let state: { className: string; label: string } | null = null;
  if (dirtyCount !== null) {
    state = {
      className: "text-warning",
      label:
        dirtyCount > 0
          ? `${dirtyCount} uncommitted ${dirtyCount === 1 ? "change" : "changes"}`
          : "Uncommitted changes",
    };
  } else if (checkout.data && workspace.mode === "current_checkout") {
    state = { className: "text-text-tertiary", label: "Clean" };
  } else if (checkout.data) {
    state = {
      className: "text-text-tertiary",
      label: checkout.data.dirty ? "Your checkout stays untouched" : "Clean",
    };
  }
  return (
    <p className="flex max-w-full flex-wrap items-center justify-center gap-x-md gap-y-xs type-caption text-text-tertiary">
      <span className="max-w-full truncate font-mono text-xs">{path}</span>
      {state ? (
        <span className={cn("flex items-center gap-xs", state.className)}>
          <span aria-hidden="true">·</span>
          {state.label}
        </span>
      ) : null}
    </p>
  );
};

const Pickers = ({ form }: { form: NewMissionForm }) => {
  const { project } = form;
  if (!project) {
    return null;
  }
  return (
    <div className="flex flex-col items-center gap-md">
      <div className="flex flex-wrap items-center justify-center gap-sm">
        <ProjectPicker
          missions={form.missions}
          onChange={form.handleProjectChange}
          projects={form.projects.data ?? []}
          value={project.id}
        />
        {form.isGit && form.workspace.mode === "new_worktree" ? (
          <BranchPicker
            onChange={form.handleBranchChange}
            projectId={project.id}
            value={form.branch}
          />
        ) : null}
        <WorkspacePicker
          canWorktree={form.isGit}
          checkoutPath={project.path}
          onChange={form.handleWorkspaceChange}
          value={form.workspace}
          worktreeRoot={form.settings.data?.worktreeRoot ?? null}
          worktrees={form.otherWorktrees}
        />
      </div>
      <CheckoutLine form={form} />
    </div>
  );
};

const ProjectArea = ({ form }: { form: NewMissionForm }) => {
  const { projects } = form;
  if (projects.isPending) {
    return (
      <div className="flex items-center gap-sm">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-7 w-32" />
      </div>
    );
  }
  if (projects.isError) {
    return (
      <p className="type-caption text-text-tertiary">
        Your projects appear here once the Missions daemon is reachable.
      </p>
    );
  }
  if (projects.data.length === 0) {
    return <ProjectsEmpty />;
  }
  return <Pickers form={form} />;
};

const DirtyWarning = ({ form }: { form: NewMissionForm }) => {
  if (!(form.needsAcknowledge && form.project)) {
    return null;
  }
  const count = form.dirtyCount ?? 0;
  const where =
    form.workspace.mode === "existing_worktree"
      ? "That worktree"
      : form.project.name;
  return (
    <Callout
      actions={
        <>
          {form.isGit ? (
            <Button
              onClick={() =>
                form.handleWorkspaceChange({ mode: "new_worktree" })
              }
              variant="secondary"
            >
              <LaptopIcon aria-hidden="true" />
              Use a new worktree
            </Button>
          ) : null}
          <Button onClick={form.handleAcknowledgeDirty} variant="ghost">
            Continue here
          </Button>
        </>
      }
      title={
        count > 0
          ? `${where} has ${count} uncommitted ${count === 1 ? "change" : "changes"}`
          : `${where} has uncommitted changes`
      }
      tone="warning"
    >
      Droids would edit on top of them and mix their work with yours. A new
      worktree starts clean and leaves your changes alone.
    </Callout>
  );
};

/** LFE: describe an outcome, pick where it runs, and start planning. */
export const NewMissionView = () => {
  const form = useNewMissionForm();
  const router = useRouter();
  const client = useQueryClient();
  const ops = useOperationIds();

  const create = useMutation({
    mutationFn: async (draft: NonNullable<NewMissionForm["draft"]>) => {
      const operationId = ops.idFor(JSON.stringify(draft));
      return await api.createMission({ ...draft, operationId });
    },
    onSuccess: (snapshot) => {
      ops.settle();
      const { mission } = snapshot;
      client.setQueryData<MissionSummary[]>(queryKeys.missions, (list) =>
        upsertById(list, {
          createdAt: mission.createdAt,
          id: mission.id,
          projectId: mission.projectId,
          status: mission.status,
          title: mission.title,
          updatedAt: mission.updatedAt,
        })
      );
      form.setGoal("");
      router.push(`/missions/${mission.id}`);
    },
  });

  const hasProject = form.project !== null;
  const canSubmit = form.draft !== null && !create.isPending;

  const submit = () => {
    if (form.draft && !create.isPending) {
      create.mutate(form.draft);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    } else if (event.key === "Tab" && event.shiftKey) {
      event.preventDefault();
      form.handleAutonomyChange(nextAutonomy(form.autonomy));
    }
  };

  return (
    <div className="relative flex min-w-0 flex-1 flex-col">
      <PageHeader>
        <PageTitle>New mission</PageTitle>
      </PageHeader>
      <ConnectionBanner />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex w-full max-w-chat flex-1 flex-col gap-lg px-lg pb-lg md:px-xl">
          <div className="flex flex-1 flex-col items-center justify-center gap-lg py-2xl text-center">
            <Wordmark />
            <p className="type-body text-text-secondary">
              {form.projects.data?.length === 0
                ? "Add a project to start your first mission."
                : "Describe an outcome. Droids plan it, build it, and check the work."}
            </p>
            <ProjectArea form={form} />
          </div>
          <DirtyWarning form={form} />
          {create.isError ? (
            <Callout
              role="alert"
              title="Could not start the mission"
              tone="danger"
            >
              {errorMessage(create.error)}
            </Callout>
          ) : null}
          <form onSubmit={onSubmit}>
            <ComposerFrame
              toolbar={
                <>
                  <AutonomyChip
                    disabled={!hasProject}
                    onChange={form.handleAutonomyChange}
                    value={form.autonomy}
                  />
                  <span className="flex-1" />
                  {form.models ? (
                    <ModelPicker
                      onChange={form.handleModelsChange}
                      value={form.models}
                    />
                  ) : null}
                  <IconButton
                    disabled={!canSubmit}
                    icon={<ArrowUpIcon />}
                    label="Start mission"
                    shape="round"
                    size="sm"
                    type="submit"
                    variant="primary"
                  />
                </>
              }
            >
              <Textarea
                aria-label="Mission goal"
                disabled={!hasProject}
                onChange={(event) => form.setGoal(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder={
                  hasProject
                    ? "Describe the mission. What should be true when it's done?"
                    : "Add a project to start a mission"
                }
                rows={2}
                value={form.goal}
                variant="bare"
              />
            </ComposerFrame>
          </form>
          <ComposerHints>
            <span className="flex items-center gap-xs">
              <Kbd>↵</Kbd> to plan
            </span>
            <span className="flex items-center gap-xs">
              <Kbd>⇧</Kbd>
              <Kbd>↵</Kbd> new line
            </span>
            <span>Nothing runs until you approve the plan.</span>
          </ComposerHints>
        </div>
      </div>
    </div>
  );
};
