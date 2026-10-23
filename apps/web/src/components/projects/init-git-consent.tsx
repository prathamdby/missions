"use client";

import { GitBranchPlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { InlineCode } from "@/components/ui/code-block";

interface InitGitConsentProps {
  error: string | null;
  onBack: () => void;
  onConfirm: () => void;
  path: string;
  pending: boolean;
}

/** MW0: explicit consent before running `git init` in a plain folder. */
export const InitGitConsent = ({
  error,
  onBack,
  onConfirm,
  path,
  pending,
}: InitGitConsentProps) => (
  <div className="flex flex-col gap-lg">
    <div className="flex gap-lg">
      <GitBranchPlusIcon
        aria-hidden="true"
        className="mt-2xs size-5 shrink-0 text-warning"
      />
      <div className="flex min-w-0 flex-col gap-sm">
        <p className="type-body text-text">
          This folder is not a Git repository.
        </p>
        <p className="font-mono text-xs break-all text-text-secondary">
          {path}
        </p>
        <p className="type-caption text-text-secondary">
          Missions uses Git to give agents a workspace, track what they change,
          and let you review diffs before anything is committed. Adding this
          folder runs <InlineCode>git init</InlineCode> here. Your files are not
          committed, moved, or modified.
        </p>
      </div>
    </div>
    {error ? (
      <Callout title="Could not initialize Git" tone="danger">
        {error}
      </Callout>
    ) : null}
    <div className="flex flex-wrap justify-end gap-md">
      <Button onClick={onBack} variant="ghost">
        Choose another folder
      </Button>
      <Button disabled={pending} onClick={onConfirm} variant="primary">
        {pending ? "Initializing…" : "Initialize Git and add"}
      </Button>
    </div>
  </div>
);
