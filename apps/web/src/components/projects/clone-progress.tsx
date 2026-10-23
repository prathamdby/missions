"use client";

import type { CloneJob, Project } from "@missions/protocol/projects";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { CodeBlock } from "@/components/ui/code-block";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/api/api-error";
import { useCloneJob, useProjects } from "@/lib/api/queries";
import { queryKeys } from "@/lib/api/query-keys";

type CloneErrorCode = NonNullable<CloneJob["error"]>["code"];

const FAILURE_TITLE: Record<CloneErrorCode, string> = {
  auth_required: "GitHub needs you to sign in",
  destination_exists: "A folder with that name already exists",
  failed: "The clone failed",
  gh_missing: "The GitHub CLI is not installed",
  network: "Could not reach the remote",
  not_found: "Repository not found",
};

const sourceLabel = (job: CloneJob) =>
  job.source.kind === "github" ? job.source.repo : job.source.url;

const CloneFailed = ({
  error,
  onBack,
  onRetry,
  retryError,
  retrying,
}: {
  error: CloneJob["error"];
  onBack: () => void;
  onRetry: () => void;
  retryError: string | null;
  retrying: boolean;
}) => {
  const code = error?.code ?? "failed";
  return (
    <div className="flex flex-col gap-lg">
      <Callout
        actions={
          <>
            <Button disabled={retrying} onClick={onRetry} variant="primary">
              {retrying ? "Retrying…" : "Try again"}
            </Button>
            <Button onClick={onBack} variant="ghost">
              Back
            </Button>
          </>
        }
        role="alert"
        title={FAILURE_TITLE[code]}
        tone="danger"
      >
        {error?.message ?? "Git reported an error."}
        {retryError ? (
          <span className="mt-xs block text-danger">{retryError}</span>
        ) : null}
      </Callout>
      {code === "auth_required" ? (
        <CodeBlock code="gh auth login" title="Sign in, then try again" />
      ) : null}
    </div>
  );
};

interface CloneProgressProps {
  jobId: string;
  onAdded: (project: Project) => void;
  onBack: () => void;
  onRetry: () => void;
  retryError: string | null;
  retrying: boolean;
}

/** NZJ while cloning, OBV on failure; hands off to OZS on success. */
export const CloneProgress = ({
  jobId,
  onAdded,
  onBack,
  onRetry,
  retryError,
  retrying,
}: CloneProgressProps) => {
  const client = useQueryClient();
  const job = useCloneJob(jobId);
  const projects = useProjects();
  const projectId =
    job.data?.status === "succeeded" ? job.data.projectId : null;
  const project = projects.data?.find((entry) => entry.id === projectId);

  useEffect(() => {
    if (projectId === null) {
      return;
    }
    if (project) {
      onAdded(project);
    } else {
      client.invalidateQueries({ queryKey: queryKeys.projects });
    }
  }, [client, onAdded, project, projectId]);

  if (job.isError && !job.data) {
    return (
      <Callout
        actions={
          <Button onClick={() => job.refetch()} variant="secondary">
            Check again
          </Button>
        }
        title="Lost track of the clone"
        tone="danger"
      >
        {errorMessage(job.error)}
      </Callout>
    );
  }

  if (job.data?.status === "failed") {
    return (
      <CloneFailed
        error={job.data.error}
        onBack={onBack}
        onRetry={onRetry}
        retryError={retryError}
        retrying={retrying}
      />
    );
  }

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex items-center gap-md">
        <Spinner label="Cloning" pattern="wave" />
        <div className="flex min-w-0 flex-col">
          <p className="truncate type-label text-text">
            {job.data ? sourceLabel(job.data) : "Starting clone…"}
          </p>
          <p className="truncate font-mono text-xs text-text-tertiary">
            {job.data?.destination ?? ""}
          </p>
        </div>
      </div>
      <p
        aria-live="polite"
        className="min-h-5 font-mono text-xs text-text-secondary"
      >
        {job.data?.progress ??
          (job.data?.status === "succeeded" ? "Finishing up…" : "")}
      </p>
      <p className="type-caption text-text-tertiary">
        You can close this window. The clone keeps going and the project appears
        in the sidebar when it is ready.
      </p>
    </div>
  );
};
