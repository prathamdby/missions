"use client";

import type { GithubAuthStatus, GithubRepo } from "@missions/protocol/projects";
import { useId } from "react";
import type { FormEvent, ReactNode } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { CommandField } from "@/components/ui/code-block";
import {
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPill,
  DialogRowButton,
  DialogSection,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconTile } from "@/components/ui/icon-tile";
import {
  ChevronRightIcon,
  FolderIcon,
  GithubIcon,
  LinkIcon,
  RepeatIcon,
  SearchIcon,
  TerminalIcon,
  UnfoldIcon,
} from "@/components/ui/icons";
import { FieldLabel, Input } from "@/components/ui/input";
import { ListOption, Listbox } from "@/components/ui/list-row";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/api/api-error";
import { useGithubRepos, useProjects } from "@/lib/api/queries";
import type { useGithubAuth } from "@/lib/api/queries";
import { formatAgo, shortAge } from "@/lib/format";
import { useDebounced } from "@/lib/use-debounced";
import { useNow } from "@/lib/use-now";

import type { GithubDraft } from "./add-project-session";
import { cloneCommand, joinPath, remoteLabel } from "./clone-target";

const SEARCH_DEBOUNCE_MS = 300;
const ALL_OWNERS = "";
const OWNER_SEPARATORS = /[-_.]/gu;

const GITHUB_DESCRIPTION =
  "Listed with your GitHub CLI login. Missions never stores tokens.";

const ownerOf = (repo: GithubRepo) => repo.nameWithOwner.split("/")[0] ?? "";
const nameOf = (repo: GithubRepo) =>
  repo.nameWithOwner.split("/").slice(1).join("/");

const useAddedRepos = () => {
  const projects = useProjects();
  const slugs = (projects.data ?? []).flatMap((project) =>
    project.remoteUrl ? [remoteLabel(project.remoteUrl).toLowerCase()] : []
  );
  return (repo: GithubRepo) => {
    const wanted = `/${repo.nameWithOwner.toLowerCase()}`;
    return slugs.some((slug) => slug.endsWith(wanted));
  };
};

const GithubHeader = ({
  description,
  pill,
}: {
  description: string;
  pill?: ReactNode;
}) => (
  <DialogHeader aside={pill}>
    <DialogTitle>Clone from GitHub</DialogTitle>
    <DialogDescription>{description}</DialogDescription>
  </DialogHeader>
);

const CancelButton = () => (
  <DialogClose asChild>
    <Button variant="ghost">Cancel</Button>
  </DialogClose>
);

interface SignInCopy {
  command: string;
  description: string;
  footnote: { command: string; label: string };
  header: string;
  pill: string;
  title: string;
}

const signInCopy = (auth: GithubAuthStatus | null): SignInCopy => {
  const login =
    auth && auth.host !== "github.com"
      ? `gh auth login --hostname ${auth.host}`
      : "gh auth login";
  if (auth?.state === "gh_missing") {
    return {
      command: "brew install gh",
      description:
        "Missions lists and clones your repositories with your local gh login. Install it once, sign in, then check again.",
      footnote: { command: login, label: "Then sign in:" },
      header: "The daemon couldn’t find the GitHub CLI on this machine.",
      pill: "gh · not installed",
      title: "Install the GitHub CLI",
    };
  }
  return {
    command: login,
    description:
      "Missions lists and clones your repositories with your local gh login. Run this once in a terminal, then check again.",
    footnote: { command: "brew install gh", label: "No gh installed?" },
    header:
      auth?.state === "error"
        ? (auth.message ?? "The daemon couldn’t check your GitHub CLI login.")
        : "The daemon couldn’t find a GitHub CLI login on this machine.",
    pill: auth?.state === "error" ? "gh · error" : "gh · signed out",
    title: "Sign in to the GitHub CLI",
  };
};

/** NNV: no usable gh login; explain the one command and offer the URL route. */
const SignIn = ({
  auth,
  checkedAt,
  checking,
  onCheck,
  onUseUrl,
}: {
  auth: GithubAuthStatus | null;
  checkedAt: number;
  checking: boolean;
  onCheck: () => void;
  onUseUrl: () => void;
}) => {
  const now = useNow();
  const copy = signInCopy(auth);
  const failed = auth === null || auth.state === "error";
  return (
    <>
      <GithubHeader
        description={copy.header}
        pill={
          <DialogPill tone={failed ? "danger" : "warning"}>
            {copy.pill}
          </DialogPill>
        }
      />
      <DialogSection padding="hero">
        <IconTile size="hero" tone="raised">
          <GithubIcon size="lg" tone="text" />
        </IconTile>
        <div className="flex flex-col items-center gap-sm">
          <p className="text-base leading-lg font-semibold tracking-tight text-text">
            {copy.title}
          </p>
          <p className="max-w-105 text-sm leading-lg font-book tracking-tight text-wrap text-text-tertiary">
            {copy.description}
          </p>
        </div>
        <CommandField command={copy.command} />
        <Button disabled={checking} onClick={onCheck} variant="secondary">
          <RepeatIcon size="sm" tone="secondary" />
          {checking ? "Checking…" : "Check again"}
        </Button>
        <p className="flex items-center gap-sm text-xs leading-sm tracking-tight text-text-tertiary">
          {copy.footnote.label}
          <code className="font-mono text-2xs leading-xs text-text-secondary">
            {copy.footnote.command}
          </code>
        </p>
      </DialogSection>
      <DialogRowButton onClick={onUseUrl}>
        <LinkIcon tone="secondary" />
        <span className="flex min-w-0 flex-1 flex-col gap-2xs">
          <span className="text-sm leading-sm font-medium tracking-tight text-text">
            Clone from a URL instead
          </span>
          <span className="text-xs leading-sm tracking-tight text-text-tertiary">
            Uses your existing git credentials: SSH keys or a credential helper.
          </span>
        </span>
        <ChevronRightIcon size="sm" tone="tertiary" />
      </DialogRowButton>
      <DialogFooter>
        <span className="text-xs leading-sm tracking-tight text-text-tertiary">
          {checkedAt > 0 ? `Checked ${formatAgo(now - checkedAt)}` : ""}
        </span>
        <span className="flex-1" />
        <CancelButton />
      </DialogFooter>
    </>
  );
};

const OwnerPicker = ({
  onChange,
  owner,
  owners,
}: {
  onChange: (owner: string) => void;
  owner: string;
  owners: readonly string[];
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button size="picker" variant="picker">
        <GithubIcon />
        {owner || "All owners"}
        <UnfoldIcon size="sm" tone="tertiary" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuRadioGroup onValueChange={onChange} value={owner}>
        <DropdownMenuRadioItem value={ALL_OWNERS}>
          All owners
        </DropdownMenuRadioItem>
        {owners.map((name) => (
          <DropdownMenuRadioItem key={name} value={name}>
            {name}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
);

const RepoRow = ({
  added,
  now,
  onClone,
  onSelect,
  repo,
  selected,
}: {
  added: boolean;
  now: number;
  onClone: () => void;
  onSelect: () => void;
  repo: GithubRepo;
  selected: boolean;
}) => {
  const owner = ownerOf(repo);
  let tag = repo.isPrivate ? "Private" : "Public";
  if (added) {
    tag = "Added";
  }
  return (
    <ListOption
      aria-disabled={added}
      onClick={added ? undefined : onSelect}
      onDoubleClick={added ? undefined : onClone}
      selected={selected}
      size="repo"
    >
      <Avatar name={owner.replaceAll(OWNER_SEPARATORS, "")} size="list" />
      <span className="flex min-w-0 flex-1 flex-col gap-stack">
        <span className="flex min-w-0 items-center">
          <span className="shrink-0 text-text-tertiary">{owner}/</span>
          <span className="truncate font-medium text-text">{nameOf(repo)}</span>
        </span>
        {repo.description ? (
          <span className="truncate text-xs leading-sm text-text-tertiary">
            {repo.description}
          </span>
        ) : null}
      </span>
      <Badge size="tag" tone="muted">
        {tag}
      </Badge>
      <span className="w-7 shrink-0 text-right text-xs leading-sm text-text-tertiary">
        {repo.updatedAt ? shortAge(repo.updatedAt, now) : ""}
      </span>
    </ListOption>
  );
};

const RepoListState = ({ children }: { children: ReactNode }) => (
  <p className="p-md text-xs leading-sm tracking-tight text-text-tertiary">
    {children}
  </p>
);

const pickTarget = (
  repos: readonly GithubRepo[],
  chosen: string | null,
  isAdded: (repo: GithubRepo) => boolean
) => {
  const selectable = repos.filter((repo) => !isAdded(repo));
  return (
    selectable.find((repo) => repo.nameWithOwner === chosen) ?? selectable[0]
  );
};

interface RepoPickerProps {
  draft: GithubDraft;
  onChangeDraft: (draft: GithubDraft) => void;
  error: string | null;
  onChangeParent: () => void;
  onClone: (repo: string) => void;
  parent: string;
  pending: boolean;
  user: string | null;
}

/** NAA: search the signed-in account's repositories and clone one. */
const RepoPicker = ({
  draft,
  onChangeDraft,
  error,
  onChangeParent,
  onClone,
  parent,
  pending,
  user,
}: RepoPickerProps) => {
  const now = useNow(60_000);
  const destinationId = useId();
  const { search, owner, chosen } = draft;
  const setSearch = (value: string) =>
    onChangeDraft({ ...draft, search: value });
  const setOwner = (value: string) => onChangeDraft({ ...draft, owner: value });
  const setChosen = (value: string) =>
    onChangeDraft({ ...draft, chosen: value });
  const query = useDebounced(search.trim(), SEARCH_DEBOUNCE_MS);
  const repos = useGithubRepos(query, true);
  const isAdded = useAddedRepos();

  const all = repos.data ?? [];
  const owners = [...new Set(all.map(ownerOf))].toSorted((a, b) =>
    a.localeCompare(b)
  );
  const visible = owner ? all.filter((repo) => ownerOf(repo) === owner) : all;
  const target = pickTarget(visible, chosen, isAdded);
  const destination = joinPath(parent, target ? nameOf(target) : "<repo>");

  const clone = () => {
    if (target && !pending) {
      onClone(target.nameWithOwner);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clone();
  };

  return (
    <>
      <GithubHeader
        description={GITHUB_DESCRIPTION}
        pill={<DialogPill>gh · {user ?? "signed in"}</DialogPill>}
      />
      <form
        className="flex items-center gap-md px-gutter pb-lg"
        onSubmit={onSubmit}
      >
        <Input
          aria-label="Search repositories"
          autoFocus
          leading={<SearchIcon tone="tertiary" />}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search repositories"
          surface="sunken"
          value={search}
        />
        <OwnerPicker onChange={setOwner} owner={owner} owners={owners} />
      </form>
      <DialogSection className="min-h-0">
        <ScrollArea asChild axis="y">
          <div className="max-h-85 min-h-40 p-md">
            <Listbox aria-label="Repositories">
              {repos.isPending ? (
                <div className="flex flex-col gap-md p-md">
                  <Skeleton className="w-1/2" />
                  <Skeleton className="w-2/3" />
                  <Skeleton className="w-1/3" />
                </div>
              ) : null}
              {repos.isError ? (
                <RepoListState>{errorMessage(repos.error)}</RepoListState>
              ) : null}
              {repos.isSuccess && visible.length === 0 ? (
                <RepoListState>
                  No repositories match {query ? `“${query}”` : "this owner"}.
                </RepoListState>
              ) : null}
              {visible.map((repo) => (
                <RepoRow
                  added={isAdded(repo)}
                  key={repo.nameWithOwner}
                  now={now}
                  onClone={() => onClone(repo.nameWithOwner)}
                  onSelect={() => setChosen(repo.nameWithOwner)}
                  repo={repo}
                  selected={repo.nameWithOwner === target?.nameWithOwner}
                />
              ))}
            </Listbox>
          </div>
        </ScrollArea>
      </DialogSection>
      <DialogSection padding="field">
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
      <DialogFooter className="flex-nowrap">
        <span className="flex min-w-0 items-center gap-sm text-text-tertiary">
          <TerminalIcon size="sm" />
          <span className="truncate font-mono text-2xs leading-xs">
            {target
              ? cloneCommand(
                  { kind: "github", repo: target.nameWithOwner },
                  destination
                )
              : "gh repo clone"}
          </span>
        </span>
        <span className="flex-1" />
        <CancelButton />
        <Button disabled={!target || pending} onClick={clone} variant="primary">
          {pending ? "Starting…" : "Clone"}
        </Button>
      </DialogFooter>
    </>
  );
};

interface GithubPickerProps {
  auth: ReturnType<typeof useGithubAuth>;
  draft: GithubDraft;
  onChangeDraft: (draft: GithubDraft) => void;
  error: string | null;
  onChangeParent: () => void;
  onClone: (repo: string) => void;
  onUseUrl: () => void;
  parent: string;
  pending: boolean;
}

/** NAA when gh is signed in, NNV when it is not. */
export const GithubPicker = ({
  auth,
  draft,
  onChangeDraft,
  error,
  onChangeParent,
  onClone,
  onUseUrl,
  parent,
  pending,
}: GithubPickerProps) => {
  if (auth.isPending) {
    return (
      <>
        <GithubHeader description={GITHUB_DESCRIPTION} />
        <DialogSection padding="hero">
          <Spinner label="Checking your GitHub CLI login" pattern="wave" />
          <p className="text-sm leading-lg tracking-tight text-text-tertiary">
            Checking your GitHub CLI login…
          </p>
        </DialogSection>
        <DialogFooter>
          <span className="flex-1" />
          <CancelButton />
        </DialogFooter>
      </>
    );
  }

  if (auth.isError || auth.data.state !== "signed_in") {
    return (
      <SignIn
        auth={auth.data ?? null}
        checkedAt={auth.dataUpdatedAt || auth.errorUpdatedAt}
        checking={auth.isFetching}
        onCheck={() => auth.refetch()}
        onUseUrl={onUseUrl}
      />
    );
  }

  return (
    <RepoPicker
      draft={draft}
      onChangeDraft={onChangeDraft}
      error={error}
      onChangeParent={onChangeParent}
      onClone={onClone}
      parent={parent}
      pending={pending}
      user={auth.data.user}
    />
  );
};
