"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { FormEvent, KeyboardEvent } from "react";
import { useMemo } from "react";

import { AutonomyChip } from "@/components/missions/autonomy-chip";
import { BranchPicker } from "@/components/new-mission/branch-picker";
import { ProjectPicker } from "@/components/new-mission/project-picker";
import { ProjectSheet } from "@/components/new-mission/project-sheet";
import { ProjectsEmpty } from "@/components/new-mission/projects-empty";
import { useNewMissionForm } from "@/components/new-mission/use-new-mission-form";
import type { NewMissionForm } from "@/components/new-mission/use-new-mission-form";
import { WorkspacePicker } from "@/components/new-mission/workspace-picker";
import { useHomeDir } from "@/components/projects/use-home-dir";
import { ConnectionBanner } from "@/components/shell/connection-banner";
import { COMPOSER_ID } from "@/components/shell/global-shortcuts";
import { PageHeader, PageTitle } from "@/components/shell/page-header";
import { Button, IconButton } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import {
  ComposerBox,
  ComposerLegend,
  ComposerToolbar,
} from "@/components/ui/composer-box";
import { Dot } from "@/components/ui/dot";
import {
  ArrowUpIcon,
  AtIcon,
  AttachIcon,
  LaptopIcon,
} from "@/components/ui/icons";
import { Textarea } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { ListCard } from "@/components/ui/list-row";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Hint } from "@/components/ui/tooltip";
import { Wordmark } from "@/components/ui/wordmark";
import { errorMessage } from "@/lib/api/api-error";
import { api } from "@/lib/api/endpoints";
import { useConnectionStatus } from "@/lib/api/queries";
import { useSingleFlightMutation } from "@/lib/api/use-operation";
import { nextAutonomy } from "@/lib/autonomy";
import { tildePath } from "@/lib/format";
import { upsertMissionSummary } from "@/lib/live/global-cache";
import { cn } from "@/lib/utils";

import { MissionCreation } from "./mission-creation";

const UNSUPPORTED = "Attachments and mentions are coming soon";

const changesLabel = (count: number) =>
  count === 1 ? "1 uncommitted change" : `${count} uncommitted changes`;

const CheckoutLine = ({
  form,
  home,
}: {
  form: NewMissionForm;
  home: string | null;
}) => {
  const { checkout, dirtyCount, project, workspace } = form;
  if (!project) {
    return null;
  }
  const path =
    workspace.mode === "existing_worktree" ? workspace.path : project.path;
  const checkoutDirty =
    workspace.mode !== "existing_worktree" && checkout.data?.dirty;
  let state: { dirty: boolean; label: string } | null = null;
  if (dirtyCount !== null) {
    state = {
      dirty: true,
      label: dirtyCount > 0 ? changesLabel(dirtyCount) : "Uncommitted changes",
    };
  } else if (checkoutDirty && checkout.data) {
    state = {
      dirty: true,
      label: changesLabel(checkout.data.dirtyFiles.length),
    };
  } else if (form.workspaceKnown) {
    state = { dirty: false, label: "Clean" };
  }
  const current = workspace.mode !== "new_worktree";
  return (
    <p className="flex max-w-full flex-wrap items-center justify-center gap-x-md gap-y-xs text-xs leading-sm tracking-tight text-text-tertiary max-md:gap-x-sm">
      <span className="max-w-full truncate font-mono leading-xs max-md:leading-sm">
        {tildePath(path, home)}
      </span>
      {state ? (
        <>
          <Dot size="separator" />
          <span
            className={cn(
              "flex items-center gap-sm",
              state.dirty && current && "text-warning"
            )}
          >
            <Dot tone={state.dirty ? "warning" : "success"} />
            {state.label}
          </span>
        </>
      ) : null}
    </p>
  );
};

const DesktopPickers = ({
  form,
  home,
}: {
  form: NewMissionForm;
  home: string | null;
}) => {
  const { project } = form;
  if (!project) {
    return null;
  }
  return (
    <div className="flex items-center gap-md max-md:hidden">
      <ProjectPicker
        missions={form.missions}
        onChange={form.handleProjectChange}
        projects={form.projects.data ?? []}
        value={project.id}
      />
      {form.isGit ? (
        <BranchPicker
          busy={form.otherWorktrees.flatMap((entry) =>
            entry.branch ? [entry.branch] : []
          )}
          defaultBranch={form.defaultBranch}
          newBranch={form.newBranch}
          onChange={form.handleBranchChange}
          onCreate={form.handleNewBranch}
          projectId={project.id}
          value={form.branch}
        />
      ) : null}
      <WorkspacePicker
        canWorktree={form.isGit}
        checkoutPath={project.path}
        home={home}
        onChange={form.handleWorkspaceChange}
        value={form.workspace}
        worktreeRoot={form.settings.data?.worktreeRoot ?? null}
        worktrees={form.otherWorktrees}
      />
    </div>
  );
};

/** YL0: the same pickers as rows in one card on touch screens. */
const TouchPickers = ({
  form,
  home,
}: {
  form: NewMissionForm;
  home: string | null;
}) => {
  const { project } = form;
  if (!project) {
    return null;
  }
  return (
    <ListCard className="w-full md:hidden">
      <ProjectSheet
        missions={form.missions}
        onChange={form.handleProjectChange}
        projects={form.projects.data ?? []}
        value={project.id}
      />
      {form.isGit ? (
        <BranchPicker
          busy={form.otherWorktrees.flatMap((entry) =>
            entry.branch ? [entry.branch] : []
          )}
          defaultBranch={form.defaultBranch}
          layout="row"
          newBranch={form.newBranch}
          onChange={form.handleBranchChange}
          onCreate={form.handleNewBranch}
          projectId={project.id}
          value={form.branch}
        />
      ) : null}
      <WorkspacePicker
        canWorktree={form.isGit}
        checkoutPath={project.path}
        home={home}
        layout="row"
        onChange={form.handleWorkspaceChange}
        value={form.workspace}
        worktreeRoot={form.settings.data?.worktreeRoot ?? null}
        worktrees={form.otherWorktrees}
      />
    </ListCard>
  );
};

const ProjectArea = ({ form }: { form: NewMissionForm }) => {
  const home = useHomeDir();
  const { projects } = form;
  if (projects.isPending) {
    return (
      <div className="flex items-center gap-md">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-32" />
      </div>
    );
  }
  if (projects.isError) {
    return (
      <p className="text-xs leading-sm text-text-tertiary">
        Your projects appear here once the Missions daemon is reachable.
      </p>
    );
  }
  if (projects.data.length === 0) {
    return <ProjectsEmpty />;
  }
  return (
    <div className="flex w-full flex-col items-center gap-control md:gap-lg">
      <DesktopPickers form={form} home={home} />
      <TouchPickers form={form} home={home} />
      <CheckoutLine form={form} home={home} />
    </div>
  );
};

const ChangedFiles = ({ files }: { files: readonly string[] }) => (
  <Popover>
    <PopoverTrigger asChild>
      <Button size="text" variant="link">
        View changes
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end">
      <p className="px-md pt-md pb-xs text-xs leading-sm font-medium text-text-tertiary">
        Uncommitted in your checkout
      </p>
      <ul className="flex max-h-60 flex-col overflow-y-auto px-md pb-md">
        {files.map((file) => (
          <li
            className="truncate py-2xs font-mono text-2xs leading-xs text-text-secondary"
            key={file}
          >
            {file}
          </li>
        ))}
      </ul>
    </PopoverContent>
  </Popover>
);

/** PZ7: droids would edit on top of uncommitted work. */
const DirtyWarning = ({ form }: { form: NewMissionForm }) => {
  if (!(form.needsAcknowledge && form.project)) {
    return null;
  }
  const count = form.dirtyCount ?? 0;
  const inWorktree = form.workspace.mode === "existing_worktree";
  const where = inWorktree ? "That worktree" : form.project.name;
  const base = form.defaultBranch ?? form.branch ?? "the base branch";
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
              <LaptopIcon size="sm" tone="secondary" />
              Use a new worktree
            </Button>
          ) : null}
          <Button onClick={form.handleAcknowledgeDirty} variant="ghost">
            {inWorktree ? "Continue in worktree" : "Continue in checkout"}
          </Button>
          <span className="flex-1" />
          {form.dirtyFiles.length > 0 ? (
            <ChangedFiles files={form.dirtyFiles} />
          ) : null}
        </>
      }
      appearance="filled"
      onDismiss={form.handleAcknowledgeDirty}
      title={
        count > 0
          ? `${where} has ${changesLabel(count)}`
          : `${where} has uncommitted changes`
      }
      tone="warning"
    >
      {inWorktree
        ? "Droids would edit on top of them and mix their work with what is already there. A new worktree starts clean and leaves those changes alone."
        : `In your current checkout, droids would edit on top of them and mix their work with yours. A new worktree starts clean from ${base} and leaves your changes alone.`}
    </Callout>
  );
};

const Tagline = ({ form }: { form: NewMissionForm }) => {
  const connection = useConnectionStatus();
  const user = connection.data?.github.user;
  const text =
    form.projects.data?.length === 0
      ? `Welcome${user ? `, ${user}` : ""}. Add a project to start your first mission.`
      : "Describe an outcome. Droids plan it, build it, and check the work.";
  return (
    <p className="w-65 text-center text-xs leading-sm tracking-tight text-text-secondary md:w-auto md:text-sm md:leading-lg md:text-text-tertiary">
      {text}
    </p>
  );
};

/** LFE: describe an outcome, pick where it runs, and start planning. */
export const NewMissionView = () => {
  const form = useNewMissionForm();
  const router = useRouter();
  const client = useQueryClient();
  const creation = useMemo(
    () => new MissionCreation({ create: api.createMission }),
    []
  );

  const create = useSingleFlightMutation({
    mutationFn: creation.submit,
    onSuccess: (snapshot) => {
      const { mission } = snapshot;
      upsertMissionSummary(client, mission);
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
        <div className="flex flex-1 flex-col items-center justify-center gap-2xl px-xl pt-lg pb-lg md:gap-section md:px-3xl md:pt-0 md:pb-2xl">
          <div className="flex flex-col items-center gap-card md:gap-gutter">
            <Wordmark size="responsive" />
            <Tagline form={form} />
          </div>
          <ProjectArea form={form} />
        </div>
        <div className="flex shrink-0 flex-col items-center gap-lg px-lg py-xs md:px-3xl md:pt-0 md:pb-gutter">
          <div className="flex w-full max-w-chat flex-col gap-lg">
            <DirtyWarning form={form} />
            {create.isError ? (
              <Callout
                appearance="filled"
                role="alert"
                title="Could not start the mission"
                tone="danger"
              >
                {errorMessage(create.error)}
              </Callout>
            ) : null}
            <form onSubmit={onSubmit}>
              <ComposerBox inert={!hasProject}>
                <Textarea
                  aria-label="Mission goal"
                  disabled={!hasProject}
                  id={COMPOSER_ID}
                  onChange={(event) => form.setGoal(event.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={
                    hasProject
                      ? "Describe the mission. What should be true when it’s done?"
                      : "Add a project to start a mission"
                  }
                  rows={1}
                  value={form.goal}
                  variant="bare"
                />
                <ComposerToolbar>
                  <Hint label={UNSUPPORTED}>
                    <IconButton
                      icon={<AttachIcon tone="secondary" />}
                      label="Attach files"
                      size="responsive"
                    />
                  </Hint>
                  <Hint label={UNSUPPORTED}>
                    <IconButton
                      icon={<AtIcon tone="secondary" />}
                      label="Mention a file"
                      size="responsive"
                    />
                  </Hint>
                  <AutonomyChip
                    disabled={!hasProject}
                    onChange={form.handleAutonomyChange}
                    value={form.autonomy}
                  />
                  <span className="flex-1" />
                  <IconButton
                    disabled={!canSubmit}
                    icon={<ArrowUpIcon />}
                    label="Start mission"
                    shape="round"
                    size="responsive"
                    type="submit"
                    variant="submit"
                  />
                </ComposerToolbar>
              </ComposerBox>
            </form>
          </div>
          <ComposerLegend>
            <span>
              <Kbd>↵</Kbd>
              to plan
            </span>
            <span>
              <Kbd>⇧</Kbd>
              <Kbd>↵</Kbd>
              new line
            </span>
            <span>Nothing runs until you approve the plan.</span>
          </ComposerLegend>
        </div>
      </div>
    </div>
  );
};
