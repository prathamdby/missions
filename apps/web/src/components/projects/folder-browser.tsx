"use client";

import {
  ArrowUpIcon,
  CornerDownLeftIcon,
  FolderGitIcon,
  FolderIcon,
} from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";

import { Tag } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { ListRow } from "@/components/ui/list-row";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api/api-error";
import { useFsBrowse } from "@/lib/api/queries";

interface FolderBrowserProps {
  error: string | null;
  onAdd: (path: string) => void;
  pending: boolean;
}

const EntriesSkeleton = () => (
  <div className="flex flex-col gap-md p-md">
    <Skeleton className="w-1/2" />
    <Skeleton className="w-2/3" />
    <Skeleton className="w-1/3" />
  </div>
);

/** MHN: walk the filesystem from home and add the current folder. */
export const FolderBrowser = ({
  error,
  onAdd,
  pending,
}: FolderBrowserProps) => {
  const [path, setPath] = useState<string | undefined>();
  const [draft, setDraft] = useState<string | null>(null);
  const browse = useFsBrowse(path);
  const current = browse.data?.path ?? path ?? "";

  const go = (next: string) => {
    setDraft(null);
    setPath(next);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const target = (draft ?? current).trim();
    if (target) {
      go(target);
    }
  };

  const parent = browse.data?.parent ?? null;
  const entries = browse.data?.entries ?? [];

  return (
    <div className="flex flex-col gap-md">
      <form className="flex items-center gap-sm" onSubmit={onSubmit}>
        <IconButton
          disabled={parent === null}
          icon={<ArrowUpIcon />}
          label="Parent folder"
          onClick={() => parent && go(parent)}
          variant="secondary"
        />
        <Input
          aria-label="Folder path"
          leading={<FolderIcon aria-hidden="true" />}
          mono
          onChange={(event) => setDraft(event.target.value)}
          spellCheck={false}
          trailing={
            draft === null ? undefined : (
              <IconButton
                icon={<CornerDownLeftIcon />}
                label="Open path"
                size="sm"
                type="submit"
              />
            )
          }
          value={draft ?? current}
        />
      </form>
      <div className="flex max-h-80 min-h-40 flex-col overflow-y-auto rounded-md bg-surface p-xs">
        {browse.isPending ? <EntriesSkeleton /> : null}
        {browse.isError ? (
          <p className="p-md type-caption text-danger">
            {errorMessage(browse.error)}
          </p>
        ) : null}
        {browse.isSuccess && entries.length === 0 ? (
          <p className="p-md type-caption text-text-tertiary">
            No folders here.
          </p>
        ) : null}
        {entries.map((entry) => (
          <ListRow key={entry.path} onClick={() => go(entry.path)}>
            {entry.isGitRepo ? (
              <FolderGitIcon aria-hidden="true" />
            ) : (
              <FolderIcon aria-hidden="true" />
            )}
            <span className="min-w-0 flex-1 truncate">{entry.name}</span>
            {entry.isGitRepo ? <Tag>git</Tag> : null}
          </ListRow>
        ))}
      </div>
      {error ? (
        <Callout title="Could not add this folder" tone="danger">
          {error}
        </Callout>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-md">
        <p className="mr-auto min-w-0 truncate font-mono text-xs text-text-tertiary">
          {current}
        </p>
        <Button
          disabled={!browse.isSuccess || pending}
          onClick={() => onAdd(current)}
          variant="primary"
        >
          {pending ? "Adding…" : "Add this folder"}
        </Button>
      </div>
    </div>
  );
};
