"use client";

import type { CloneSource, Project } from "@missions/protocol/projects";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { errorMessage } from "@/lib/api/api-error";
import { api } from "@/lib/api/endpoints";
import { useGithubAuth } from "@/lib/api/queries";
import { queryKeys } from "@/lib/api/query-keys";
import { useOperationIds } from "@/lib/api/use-operation";
import { upsertById } from "@/lib/live/global-cache";

import { CloneProgress } from "./clone-progress";
import { DEFAULT_CLONE_PARENT, repoNameOf } from "./clone-target";
import { FolderBrowser } from "./folder-browser";
import { GithubPicker } from "./github-picker";
import { UrlClone } from "./url-clone";

export type AddProjectStep =
  | { kind: "browse" }
  | { kind: "cloning"; jobId: string; source: CloneSource }
  | { kind: "github" }
  | { kind: "pick_parent"; from: "github" | "url"; repoName: string }
  | { kind: "url" };

export type AddedVia = "clone" | "local";

interface AddProjectDialogProps {
  onAdded: (project: Project, via: AddedVia) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  setStep: (step: AddProjectStep) => void;
  step: AddProjectStep;
}

type DialogSize = "lg" | "md" | "prose" | "wide";

const useDialogSize = (step: AddProjectStep, open: boolean): DialogSize => {
  const auth = useGithubAuth(open && step.kind === "github");
  switch (step.kind) {
    case "browse":
    case "pick_parent": {
      return "lg";
    }
    case "github": {
      return auth.data?.state === "signed_in" ? "wide" : "prose";
    }
    case "url": {
      return "md";
    }
    default: {
      return "prose";
    }
  }
};

/** Add-project flows: browse (MHN, MW0), GitHub (NAA, NNV), URL (ONT), clone (NZJ, OBV). */
export const AddProjectDialog = ({
  onAdded,
  onOpenChange,
  open,
  setStep,
  step,
}: AddProjectDialogProps) => {
  const client = useQueryClient();
  const addOps = useOperationIds();
  const cloneOps = useOperationIds();
  const [notGitPath, setNotGitPath] = useState<string | null>(null);
  const [cloneParent, setCloneParent] = useState(DEFAULT_CLONE_PARENT);
  const [url, setUrl] = useState("");
  const size = useDialogSize(step, open);

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
        setNotGitPath(response.path);
        return;
      }
      setNotGitPath(null);
      client.setQueryData<Project[]>(queryKeys.projects, (list) =>
        upsertById(list, response.project)
      );
      onAdded(response.project, "local");
    },
  });

  const clone = useMutation({
    mutationFn: (source: CloneSource) =>
      api.clone({
        destinationParent: cloneParent,
        operationId: cloneOps.idFor(`${cloneParent}:${JSON.stringify(source)}`),
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

  const addError = add.error ? errorMessage(add.error) : null;
  const cloneError = clone.error ? errorMessage(clone.error) : null;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent size={size}>
        {step.kind === "browse" ? (
          <FolderBrowser
            error={addError}
            mode="add"
            notGitPath={notGitPath}
            onConfirm={(path, initializeGit) =>
              add.mutate({ initializeGit, path })
            }
            pending={add.isPending}
          />
        ) : null}
        {step.kind === "pick_parent" ? (
          <FolderBrowser
            error={null}
            mode="choose"
            onCancel={() => changeStep({ kind: step.from })}
            onConfirm={(path) => {
              setCloneParent(path);
              changeStep({ kind: step.from });
            }}
            pending={false}
            repoName={step.repoName}
            startPath={cloneParent}
          />
        ) : null}
        {step.kind === "github" ? (
          <GithubPicker
            error={cloneError}
            onChangeParent={() =>
              changeStep({
                from: "github",
                kind: "pick_parent",
                repoName: "the repository",
              })
            }
            onClone={(repo) => clone.mutate({ kind: "github", repo })}
            onUseUrl={() => changeStep({ kind: "url" })}
            parent={cloneParent}
            pending={clone.isPending}
          />
        ) : null}
        {step.kind === "url" ? (
          <UrlClone
            error={cloneError}
            onChangeParent={() =>
              changeStep({
                from: "url",
                kind: "pick_parent",
                repoName: url.trim()
                  ? repoNameOf({ kind: "url", url: url.trim() })
                  : "the repository",
              })
            }
            onClone={(remote) => clone.mutate({ kind: "url", url: remote })}
            onUrlChange={setUrl}
            parent={cloneParent}
            pending={clone.isPending}
            url={url}
          />
        ) : null}
        {step.kind === "cloning" ? (
          <CloneProgress
            jobId={step.jobId}
            onAdded={(project) => onAdded(project, "clone")}
            onBack={() =>
              changeStep({
                kind: step.source.kind === "github" ? "github" : "url",
              })
            }
            onRetry={() => clone.mutate(step.source)}
            retryError={cloneError}
            retrying={clone.isPending}
            source={step.source}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
};
