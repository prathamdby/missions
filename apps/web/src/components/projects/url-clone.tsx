"use client";

import { useId, useState } from "react";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { CommandPreview } from "@/components/ui/code-block";
import {
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogSection,
  DialogTitle,
} from "@/components/ui/dialog";
import { Dot } from "@/components/ui/dot";
import {
  BranchIcon,
  CheckIcon,
  FolderIcon,
  LinkIcon,
  TerminalIcon,
  UnfoldIcon,
} from "@/components/ui/icons";
import { FieldHint, FieldLabel, Input } from "@/components/ui/input";

import { cloneCommand, joinPath, repoNameOf } from "./clone-target";

const SSH_REMOTE = /^(?:ssh:\/\/)?[\w.-]+@[\w.-]+[:/].+/u;
const HTTPS_REMOTE = /^https?:\/\/[\w.-]+(?::\d+)?\/.+/u;

type RemoteKind = "https" | "ssh" | null;

const remoteKind = (url: string): RemoteKind => {
  if (SSH_REMOTE.test(url)) {
    return "ssh";
  }
  if (HTTPS_REMOTE.test(url)) {
    return "https";
  }
  return null;
};

const REMOTE_COPY = {
  https: { auth: "credential helper", label: "HTTPS remote" },
  ssh: { auth: "key from ssh-agent", label: "SSH remote" },
} as const;

interface UrlCloneProps {
  error: string | null;
  onChangeParent: () => void;
  onClone: (url: string) => void;
  /** Kept across a trip to the folder picker. */
  onUrlChange: (url: string) => void;
  parent: string;
  pending: boolean;
  url: string;
}

/** ONT: clone any reachable Git remote. */
export const UrlClone = ({
  error,
  onChangeParent,
  onClone,
  onUrlChange,
  parent,
  pending,
  url,
}: UrlCloneProps) => {
  const urlId = useId();
  const destinationId = useId();
  const branchId = useId();
  const [touched, setTouched] = useState(false);
  const trimmed = url.trim();
  const kind = remoteKind(trimmed);
  const destination = joinPath(
    parent,
    trimmed ? repoNameOf({ kind: "url", url: trimmed }) : "<repo>"
  );
  const invalid = touched && trimmed !== "" && kind === null;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (kind && !pending) {
      onClone(trimmed);
    }
  };

  return (
    <form className="flex min-h-0 flex-col" onSubmit={onSubmit}>
      <DialogHeader>
        <DialogTitle>Clone from URL</DialogTitle>
        <DialogDescription>
          Any SSH or HTTPS remote. git uses the credentials already on this
          machine.
        </DialogDescription>
      </DialogHeader>
      <DialogSection padding="form">
        <div className="flex flex-col gap-sm">
          <FieldLabel htmlFor={urlId} size="xs">
            Repository URL
          </FieldLabel>
          <Input
            aria-invalid={invalid}
            autoFocus
            id={urlId}
            leading={<LinkIcon tone="tertiary" />}
            mono
            onBlur={() => setTouched(true)}
            onChange={(event) => onUrlChange(event.target.value)}
            placeholder="git@github.com:owner/repo.git"
            spellCheck={false}
            surface="sunken"
            value={url}
          />
          {kind ? (
            <p className="flex items-center gap-sm text-xs leading-sm tracking-tight">
              <CheckIcon size="sm" tone="success" />
              <span className="text-text-secondary">
                {REMOTE_COPY[kind].label}
              </span>
              <Dot size="separator" />
              <span className="text-text-tertiary">
                {REMOTE_COPY[kind].auth}
              </span>
            </p>
          ) : null}
          {invalid ? (
            <FieldHint tone="danger">
              Use an SSH remote (git@host:owner/repo.git) or an HTTPS URL.
            </FieldHint>
          ) : null}
        </div>
        <div className="flex flex-col gap-sm">
          <FieldLabel htmlFor={destinationId} size="xs">
            Clone to
          </FieldLabel>
          <div className="flex items-center gap-md">
            <Input
              id={destinationId}
              leading={<FolderIcon tone="tertiary" />}
              mono
              readOnly
              surface="sunken"
              value={destination}
            />
            <Button onClick={onChangeParent} variant="secondary">
              Change
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-sm">
          <FieldLabel htmlFor={branchId} size="xs">
            Branch
          </FieldLabel>
          <Input
            disabled
            id={branchId}
            leading={<BranchIcon tone="tertiary" />}
            readOnly
            surface="sunken"
            trailing={<UnfoldIcon size="sm" tone="tertiary" />}
            value="Default branch"
          />
          <FieldHint>
            The daemon checks out the remote’s default branch after cloning.
          </FieldHint>
        </div>
        <CommandPreview
          command={
            kind
              ? cloneCommand({ kind: "url", url: trimmed }, destination)
              : `git clone <url> ${destination}`
          }
          icon={<TerminalIcon size="sm" />}
        />
      </DialogSection>
      {error ? (
        <DialogSection padding="row">
          <Callout
            appearance="filled"
            role="alert"
            title={error}
            tone="danger"
          />
        </DialogSection>
      ) : null}
      <DialogFooter>
        <span className="flex-1" />
        <DialogClose asChild>
          <Button variant="ghost">Cancel</Button>
        </DialogClose>
        <Button disabled={!kind || pending} type="submit" variant="primary">
          {pending ? "Starting…" : "Clone"}
        </Button>
      </DialogFooter>
    </form>
  );
};
