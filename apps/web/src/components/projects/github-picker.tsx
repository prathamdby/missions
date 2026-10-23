"use client";

import type { GithubAuthStatus } from "@missions/protocol/projects";
import { LockIcon, RotateCwIcon, SearchIcon } from "lucide-react";
import { useState } from "react";

import { Tag } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { CodeBlock } from "@/components/ui/code-block";
import { Input } from "@/components/ui/input";
import { ListRow } from "@/components/ui/list-row";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/api/api-error";
import { useGithubAuth, useGithubRepos } from "@/lib/api/queries";
import { useDebounced } from "@/lib/use-debounced";

const SEARCH_DEBOUNCE_MS = 300;

interface GithubPickerProps {
  error: string | null;
  onClone: (repo: string) => void;
  onUseUrl: () => void;
  pending: boolean;
}

/** NNV and friends: what to do when `gh` cannot list repositories. */
const AuthGuidance = ({
  auth,
  checking,
  onCheck,
  onUseUrl,
}: {
  auth: GithubAuthStatus;
  checking: boolean;
  onCheck: () => void;
  onUseUrl: () => void;
}) => {
  const missing = auth.state === "gh_missing";
  let title = "Sign in to the GitHub CLI";
  if (missing) {
    title = "The GitHub CLI is not installed";
  } else if (auth.state === "error") {
    title = "Could not check your GitHub sign-in";
  }
  return (
    <div className="flex flex-col gap-lg">
      <Callout
        actions={
          <>
            <Button disabled={checking} onClick={onCheck} variant="secondary">
              <RotateCwIcon aria-hidden="true" />
              {checking ? "Checking…" : "Check again"}
            </Button>
            <Button onClick={onUseUrl} variant="ghost">
              Clone from URL instead
            </Button>
          </>
        }
        title={title}
        tone={auth.state === "error" ? "danger" : "info"}
      >
        {missing
          ? "Install it from cli.github.com, then sign in. Missions never stores GitHub credentials."
          : "Missions lists repositories through gh and never stores GitHub credentials. Run this in a terminal, then check again."}
        {auth.message ? (
          <span className="mt-xs block">{auth.message}</span>
        ) : null}
      </Callout>
      <CodeBlock
        code={`gh auth login --hostname ${auth.host}`}
        title="Terminal"
      />
    </div>
  );
};

const RepoList = ({
  onClone,
  pending,
  query,
}: {
  onClone: (repo: string) => void;
  pending: boolean;
  query: string;
}) => {
  const repos = useGithubRepos(query, true);
  if (repos.isPending) {
    return (
      <div className="flex flex-col gap-md p-md">
        <Skeleton className="w-1/2" />
        <Skeleton className="w-2/3" />
        <Skeleton className="w-1/3" />
      </div>
    );
  }
  if (repos.isError) {
    return (
      <p className="p-md type-caption text-danger">
        {errorMessage(repos.error)}
      </p>
    );
  }
  if (repos.data.length === 0) {
    return (
      <p className="p-md type-caption text-text-tertiary">
        No repositories match {query ? `“${query}”` : "your account"}.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2xs">
      {repos.data.map((repo) => (
        <li key={repo.nameWithOwner}>
          <ListRow
            disabled={pending}
            onClick={() => onClone(repo.nameWithOwner)}
            size="lg"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate type-label text-text">
                {repo.nameWithOwner}
              </span>
              {repo.description ? (
                <span className="truncate type-caption text-text-tertiary">
                  {repo.description}
                </span>
              ) : null}
            </span>
            {repo.isPrivate ? (
              <Tag>
                <LockIcon aria-hidden="true" className="size-3" />
                private
              </Tag>
            ) : null}
          </ListRow>
        </li>
      ))}
    </ul>
  );
};

/** NAA: search the signed-in account's repositories and clone one. */
export const GithubPicker = ({
  error,
  onClone,
  onUseUrl,
  pending,
}: GithubPickerProps) => {
  const auth = useGithubAuth();
  const [search, setSearch] = useState("");
  const query = useDebounced(search.trim(), SEARCH_DEBOUNCE_MS);

  if (auth.isPending) {
    return (
      <div className="flex items-center gap-md py-lg type-caption text-text-secondary">
        <Spinner label="Checking GitHub sign-in" size="sm" />
        Checking GitHub sign-in…
      </div>
    );
  }
  if (auth.isError) {
    return (
      <Callout
        actions={
          <Button onClick={() => auth.refetch()} variant="secondary">
            Try again
          </Button>
        }
        title="Could not check your GitHub sign-in"
        tone="danger"
      >
        {errorMessage(auth.error)}
      </Callout>
    );
  }
  if (auth.data.state !== "signed_in") {
    return (
      <AuthGuidance
        auth={auth.data}
        checking={auth.isFetching}
        onCheck={() => auth.refetch()}
        onUseUrl={onUseUrl}
      />
    );
  }

  return (
    <div className="flex flex-col gap-md">
      <Input
        aria-label="Search repositories"
        leading={<SearchIcon aria-hidden="true" />}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={`Search ${auth.data.user ?? "your"} repositories`}
        value={search}
      />
      <div className="max-h-80 min-h-40 overflow-y-auto rounded-md bg-surface p-xs">
        <RepoList onClone={onClone} pending={pending} query={query} />
      </div>
      {error ? (
        <Callout title="Could not start the clone" tone="danger">
          {error}
        </Callout>
      ) : null}
      <p className="type-caption text-text-tertiary">
        Signed in as {auth.data.user ?? "unknown"} on {auth.data.host}. Clones
        into ~/.missions/repos.
      </p>
    </div>
  );
};
