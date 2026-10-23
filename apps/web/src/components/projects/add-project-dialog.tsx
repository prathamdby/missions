"use client";

import type { CloneSource, Project } from "@missions/protocol/projects";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  CloudDownloadIcon,
  FolderOpenIcon,
  LinkIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { CloneProgress } from "@/components/projects/clone-progress";
import { FolderBrowser } from "@/components/projects/folder-browser";
import { GithubPicker } from "@/components/projects/github-picker";
import { InitGitConsent } from "@/components/projects/init-git-consent";
import { ProjectAdded } from "@/components/projects/project-added";
import { UrlClone } from "@/components/projects/url-clone";
import { IconButton } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ListRow } from "@/components/ui/list-row";
import { errorMessage } from "@/lib/api/api-error";
import { api } from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/query-keys";
import { useOperationIds } from "@/lib/api/use-operation";
import { upsertById } from "@/lib/live/global-cache";

export type AddProjectStep =
  | { kind: "added"; project: Project }
  | { kind: "browse" }
  | { kind: "choose" }
  | { kind: "cloning"; jobId: string; source: CloneSource }
  | { kind: "github" }
  | { kind: "not_git"; path: string }
  | { kind: "url" };

interface AddProjectDialogProps {
  onAdded: (project: Project) => void;
  onOpenChange: (open: boolean) => void;
  onStartMission: (project: Project) => void;
  open: boolean;
  setStep: (step: AddProjectStep) => void;
  step: AddProjectStep;
}

const COPY: Record<
  AddProjectStep["kind"],
  { description: string; title: string }
> = {
  added: { description: "", title: "Project added" },
  browse: {
    description: "Pick the folder that holds your code.",
    title: "Open a local folder",
  },
  choose: {
    description: "Missions work inside a Git repository on this machine.",
    title: "Add a project",
  },
  cloning: { description: "", title: "Cloning repository" },
  github: {
    description: "Uses your GitHub CLI sign-in.",
    title: "Clone from GitHub",
  },
  not_git: { description: "", title: "Initialize Git?" },
  url: {
    description: "Any Git remote your machine can reach.",
    title: "Clone from URL",
  },
};

const ChooseOption = ({
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
  <ListRow onClick={onSelect} size="lg">
    {icon}
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="type-label text-text">{title}</span>
      <span className="type-caption text-text-tertiary">{description}</span>
    </span>
  </ListRow>
);

const ChooseSource = ({
  setStep,
}: {
  setStep: (step: AddProjectStep) => void;
}) => (
  <div className="-mx-md flex flex-col gap-2xs">
    <ChooseOption
      description="A repository or folder already on this machine"
      icon={<FolderOpenIcon aria-hidden="true" />}
      onSelect={() => setStep({ kind: "browse" })}
      title="Open a local folder"
    />
    <ChooseOption
      description="Pick from repositories you can access"
      icon={<CloudDownloadIcon aria-hidden="true" />}
      onSelect={() => setStep({ kind: "github" })}
      title="Clone from GitHub"
    />
    <ChooseOption
      description="HTTPS or SSH remote"
      icon={<LinkIcon aria-hidden="true" />}
      onSelect={() => setStep({ kind: "url" })}
      title="Clone from URL"
    />
  </div>
);

const backTarget = (step: AddProjectStep): AddProjectStep | null => {
  switch (step.kind) {
    case "browse":
    case "github":
    case "url": {
      return { kind: "choose" };
    }
    case "not_git": {
      return { kind: "browse" };
    }
    default: {
      return null;
    }
  }
};

/** Add-project flow: choose a source, then browse, clone, or confirm `git init`. */
export const AddProjectDialog = ({
  onAdded,
  onOpenChange,
  onStartMission,
  open,
  setStep,
  step,
}: AddProjectDialogProps) => {
  const client = useQueryClient();
  const addOps = useOperationIds();
  const cloneOps = useOperationIds();

  const add = useMutation({
    mutationFn: ({
      initializeGit,
      path,
    }: {
      initializeGit: boolean;
      path: string;
    }) =>
      api.addProject({
        initializeGit,
        operationId: addOps.idFor(`${path}:${initializeGit}`),
        path,
      }),
    onSuccess: (response) => {
      addOps.settle();
      if (response.status === "not_git") {
        setStep({ kind: "not_git", path: response.path });
        return;
      }
      client.setQueryData<Project[]>(queryKeys.projects, (list) =>
        upsertById(list, response.project)
      );
      onAdded(response.project);
    },
  });

  const clone = useMutation({
    mutationFn: (source: CloneSource) =>
      api.clone({
        operationId: cloneOps.idFor(JSON.stringify(source)),
        source,
      }),
    onSuccess: (job) => {
      cloneOps.settle();
      client.setQueryData(queryKeys.cloneJob(job.id), job);
      setStep({ jobId: job.id, kind: "cloning", source: job.source });
    },
  });

  const changeStep = (next: AddProjectStep) => {
    add.reset();
    clone.reset();
    setStep(next);
  };

  const back = backTarget(step);
  const copy = COPY[step.kind];
  const addError = add.error ? errorMessage(add.error) : null;
  const cloneError = clone.error ? errorMessage(clone.error) : null;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent size="lg">
        <DialogHeader>
          <div className="flex items-center gap-sm">
            {back ? (
              <IconButton
                className="-ml-sm"
                icon={<ArrowLeftIcon />}
                label="Back"
                onClick={() => changeStep(back)}
                size="sm"
              />
            ) : null}
            <DialogTitle>{copy.title}</DialogTitle>
          </div>
          {copy.description ? (
            <DialogDescription>{copy.description}</DialogDescription>
          ) : (
            <DialogDescription className="sr-only">
              {copy.title}
            </DialogDescription>
          )}
        </DialogHeader>
        <DialogBody>
          {step.kind === "choose" ? (
            <ChooseSource setStep={changeStep} />
          ) : null}
          {step.kind === "browse" ? (
            <FolderBrowser
              error={addError}
              onAdd={(path) => add.mutate({ initializeGit: false, path })}
              pending={add.isPending}
            />
          ) : null}
          {step.kind === "not_git" ? (
            <InitGitConsent
              error={addError}
              onBack={() => changeStep({ kind: "browse" })}
              onConfirm={() =>
                add.mutate({ initializeGit: true, path: step.path })
              }
              path={step.path}
              pending={add.isPending}
            />
          ) : null}
          {step.kind === "github" ? (
            <GithubPicker
              error={cloneError}
              onClone={(repo) => clone.mutate({ kind: "github", repo })}
              onUseUrl={() => changeStep({ kind: "url" })}
              pending={clone.isPending}
            />
          ) : null}
          {step.kind === "url" ? (
            <UrlClone
              error={cloneError}
              onClone={(url) => clone.mutate({ kind: "url", url })}
              pending={clone.isPending}
            />
          ) : null}
          {step.kind === "cloning" ? (
            <CloneProgress
              jobId={step.jobId}
              onAdded={onAdded}
              onBack={() =>
                changeStep({
                  kind: step.source.kind === "github" ? "github" : "url",
                })
              }
              onRetry={() => clone.mutate(step.source)}
              retryError={cloneError}
              retrying={clone.isPending}
            />
          ) : null}
          {step.kind === "added" ? (
            <ProjectAdded
              onAddAnother={() => changeStep({ kind: "choose" })}
              onStartMission={() => onStartMission(step.project)}
              project={step.project}
            />
          ) : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
};
