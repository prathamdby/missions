"use client";

import type { Changes } from "@missions/protocol/files";
import type { Mission } from "@missions/protocol/missions";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import {
  ChatCard,
  ChatCardBody,
  ChatCardFooter,
  ChatCardHeader,
  CheckboxRow,
  EventLine,
} from "@/components/mission/chat-cards";
import {
  ArrowUpRightIcon,
  CheckIcon,
  DownloadIcon,
  LayersIcon,
  CloseIcon,
  MergeIcon,
  PullRequestIcon,
} from "@/components/mission/icons";
import { useMission } from "@/components/mission/mission-context";
import { DotLoader } from "@/components/mission/panel-kit";
import { reportMutationError } from "@/components/mission/report-error";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { api } from "@/lib/api/endpoints";
import { useChanges, useGithubAuth } from "@/lib/api/queries";
import { queryKeys } from "@/lib/api/query-keys";
import {
  useOperationIds,
  useSingleFlightMutation,
} from "@/lib/api/use-operation";
import { formatDuration } from "@/lib/format";
import { displayStatus } from "@/lib/mission/display-status";
import {
  canArchive,
  defaultCommitMessage,
  defaultPrBody,
  finishState,
} from "@/lib/mission/finish";
import { groupTodos } from "@/lib/mission/overview";
import { checksLabel, prRef } from "@/lib/mission/pr";

const fieldClass =
  "w-full rounded-sm bg-surface px-lg py-control text-sm leading-chat font-book tracking-tight text-text outline-none ring-1 ring-border placeholder:text-text-tertiary focus-visible:ring-border-strong";

/** One mutation per finish intent, sharing ID reuse, refetch, and conflict handling. */
const useFinishMutation = <T,>(
  title: string,
  intent: (input: T) => string,
  run: (operationId: string, input: T) => Promise<Mission>
) => {
  const { applyLocal, missionId, refresh } = useMission();
  const queryClient = useQueryClient();
  const ops = useOperationIds();
  return useSingleFlightMutation({
    mutationFn: (input: T) => run(ops.idFor(intent(input)), input),
    onError: (error) => {
      ops.release(error);
      queryClient.invalidateQueries({ queryKey: queryKeys.changes(missionId) });
      reportMutationError(error, refresh, title);
    },
    onSuccess: (mission) => {
      ops.settle();
      applyLocal({ kind: "mission", value: mission });
      queryClient.invalidateQueries({ queryKey: queryKeys.changes(missionId) });
    },
  });
};

const Totals = ({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) => (
  <span className="flex gap-sm font-mono text-2xs leading-xs">
    <span className="text-success">+{additions}</span>
    <span className="text-danger">−{deletions}</span>
  </span>
);

const GithubGuidance = () => {
  const auth = useGithubAuth();
  if (!auth.data || auth.data.state === "signed_in") {
    return null;
  }
  const text =
    auth.data.state === "gh_missing"
      ? "The GitHub CLI is not installed on this machine. Install gh, then run gh auth login."
      : "The GitHub CLI is signed out. Run gh auth login on this machine, then try again.";
  return (
    <output className="text-xs leading-sm text-warning">
      {auth.data.message ?? text}
    </output>
  );
};

const CommitCard = ({
  changes,
  pending,
  preExisting,
}: {
  changes: Changes;
  pending: Changes["files"];
  preExisting: Changes["files"];
}) => {
  const { live, missionId, showPanel } = useMission();
  const [message, setMessage] = useState(() =>
    defaultCommitMessage(live.mission)
  );
  const [includePreExisting, setIncludePreExisting] = useState(false);
  const commit = useFinishMutation(
    "Could not commit",
    () => `commit:${changes.hash}`,
    (operationId, input: { includePreExisting: boolean; message: string }) =>
      api.commit(missionId, {
        expectedChangesHash: changes.hash,
        expectedHead: changes.head,
        includePreExisting: input.includePreExisting,
        message: input.message,
        operationId,
      })
  );
  const included = includePreExisting ? [...pending, ...preExisting] : pending;
  const additions = included.reduce((sum, file) => sum + file.additions, 0);
  const deletions = included.reduce((sum, file) => sum + file.deletions, 0);
  const blocked = included.length === 0;
  return (
    <ChatCard label="Commit changes" testId="commit-card">
      <ChatCardHeader icon={<CheckIcon className="text-text-secondary" />}>
        Commit {included.length} file{included.length === 1 ? "" : "s"}
      </ChatCardHeader>
      <ChatCardBody>
        <div className="flex items-center gap-md">
          <span className="text-xs leading-sm text-text-tertiary">
            To {live.mission.workspace?.branch ?? "the current branch"}
          </span>
          <Totals additions={additions} deletions={deletions} />
        </div>
        <label className="flex flex-col gap-sm">
          <span className="text-xs leading-sm font-medium text-text-secondary">
            Commit message
          </span>
          <textarea
            className={`${fieldClass} min-h-20 resize-y font-mono text-xs leading-md`}
            data-testid="commit-message"
            onChange={(event) => setMessage(event.target.value)}
            rows={3}
            value={message}
          />
        </label>
        {preExisting.length > 0 ? (
          <CheckboxRow
            checked={includePreExisting}
            onChange={setIncludePreExisting}
            testId="commit-include-preexisting"
          >
            Include {preExisting.length} file
            {preExisting.length === 1 ? "" : "s"} changed before the mission
            started. Review first: they may mix your edits with the droids’.
          </CheckboxRow>
        ) : null}
      </ChatCardBody>
      <ChatCardFooter>
        <Button
          data-testid="commit-submit"
          disabled={commit.isPending || blocked || !message.trim()}
          onClick={() =>
            commit.mutate({ includePreExisting, message: message.trim() })
          }
          title={
            blocked
              ? "Only files changed before the mission remain. Review and include them to commit."
              : undefined
          }
          variant="primary"
        >
          {commit.isPending ? "Committing…" : "Commit"}
        </Button>
        <Button onClick={() => showPanel("changes")} variant="secondary">
          Review changes
        </Button>
      </ChatCardFooter>
    </ChatCard>
  );
};

const PushCard = ({ head }: { head: string | null }) => {
  const { live, missionId } = useMission();
  const { publish, workspace } = live.mission;
  const push = useFinishMutation(
    "Could not push",
    () => `push:${head ?? ""}`,
    (operationId) =>
      api.push(missionId, { expectedHead: head ?? "", operationId })
  );
  const latest = publish.commits.at(-1);
  return (
    <ChatCard label="Push branch" testId="push-card">
      <ChatCardHeader
        icon={<ArrowUpRightIcon className="text-text-secondary" />}
      >
        Push {workspace?.branch ?? "branch"}
      </ChatCardHeader>
      <ChatCardBody>
        <p className="text-sm leading-chat font-book text-text-secondary">
          {publish.commits.length} commit
          {publish.commits.length === 1 ? "" : "s"} ready
          {publish.remote ? ` for ${publish.remote}` : ""}.
          {latest ? (
            <span className="ml-sm font-mono text-2xs text-text-tertiary">
              {latest.sha.slice(0, 7)} {latest.message.split("\n")[0]}
            </span>
          ) : null}
        </p>
        <GithubGuidance />
      </ChatCardBody>
      <ChatCardFooter>
        <Button
          data-testid="push-submit"
          disabled={push.isPending || !head}
          onClick={() => push.mutate(undefined)}
          variant="primary"
        >
          {push.isPending ? "Pushing…" : "Push"}
        </Button>
      </ChatCardFooter>
    </ChatCard>
  );
};

const CreatePrCard = ({ head }: { head: string | null }) => {
  const { live, missionId } = useMission();
  const { mission } = live;
  const auth = useGithubAuth();
  const [title, setTitle] = useState(mission.title);
  const [body, setBody] = useState(() => defaultPrBody(mission));
  const create = useFinishMutation(
    "Could not open the pull request",
    () => `pr:${head ?? ""}`,
    (operationId, input: { body: string; title: string }) =>
      api.createPullRequest(missionId, {
        body: input.body,
        expectedHead: head ?? "",
        operationId,
        title: input.title,
      })
  );
  const signedOut = auth.data !== undefined && auth.data.state !== "signed_in";
  const base = mission.workspace?.baseRef ?? "main";
  const onBase = mission.publish.pushedBranch === base;
  return (
    <ChatCard label="Open a pull request" testId="pr-create-card">
      <ChatCardHeader
        icon={<PullRequestIcon className="text-text-secondary" />}
      >
        Open a pull request
      </ChatCardHeader>
      <ChatCardBody>
        <span className="font-mono text-2xs leading-xs text-text-tertiary">
          {base} ← {mission.publish.pushedBranch}
        </span>
        {onBase ? (
          <output className="text-xs leading-sm text-warning">
            The commits are on {base}, the base branch, so there is nothing to
            compare. Start the mission in a new worktree to open a pull request.
          </output>
        ) : null}
        <label className="flex flex-col gap-sm">
          <span className="text-xs leading-sm font-medium text-text-secondary">
            Title
          </span>
          <input
            className={fieldClass}
            data-testid="pr-title"
            onChange={(event) => setTitle(event.target.value)}
            value={title}
          />
        </label>
        <label className="flex flex-col gap-sm">
          <span className="text-xs leading-sm font-medium text-text-secondary">
            Description
          </span>
          <textarea
            className={`${fieldClass} min-h-24 resize-y`}
            data-testid="pr-body"
            onChange={(event) => setBody(event.target.value)}
            rows={4}
            value={body}
          />
        </label>
        <GithubGuidance />
      </ChatCardBody>
      <ChatCardFooter>
        <Button
          data-testid="pr-submit"
          disabled={
            create.isPending || !head || !title.trim() || signedOut || onBase
          }
          onClick={() => create.mutate({ body, title: title.trim() })}
          variant="primary"
        >
          {create.isPending ? "Opening…" : "Create draft pull request"}
        </Button>
      </ChatCardFooter>
    </ChatCard>
  );
};

const CHECK_ICON = {
  failing: <CloseIcon className="size-3.5 text-danger" />,
  none: null,
  passing: <CheckIcon className="size-3.5 text-success" />,
  pending: <DotLoader label="Checks running" tone="accent" />,
} as const;

const PrCard = ({ changes }: { changes: Changes | undefined }) => {
  const { applyLocal, live, missionId, refresh } = useMission();
  const { mission } = live;
  const { pr } = mission.publish;
  const status = displayStatus(live);
  const sync = useSingleFlightMutation({
    mutationFn: () => api.pullRequest(missionId),
    onError: (error) =>
      reportMutationError(error, refresh, "Could not refresh the pull request"),
    onSuccess: (value) => applyLocal({ kind: "mission", value }),
  });
  if (!pr) {
    return null;
  }
  const checks = checksLabel(pr.checks);
  return (
    <ChatCard label={`Pull request ${prRef(pr)}`} testId="pr-card">
      <ChatCardHeader
        icon={
          pr.state === "merged" ? (
            <MergeIcon className="text-success" />
          ) : (
            <PullRequestIcon className="text-text-secondary" />
          )
        }
        status={
          pr.state === "closed" ? { label: "Closed", tone: "quiet" } : status
        }
      >
        #{pr.number} {mission.title}
      </ChatCardHeader>
      <div className="flex items-center gap-md px-card pt-control pb-xs">
        <span className="font-mono text-2xs leading-xs text-text-tertiary">
          {mission.workspace?.baseRef ?? "main"} ←{" "}
          {mission.publish.pushedBranch}
        </span>
        {changes ? (
          <>
            <Totals
              additions={changes.totals.additions}
              deletions={changes.totals.deletions}
            />
            <span className="text-xs leading-sm text-text-tertiary">
              · {changes.totals.files} file
              {changes.totals.files === 1 ? "" : "s"}
            </span>
          </>
        ) : null}
        {pr.isDraft ? (
          <span className="text-xs leading-sm text-text-tertiary">· Draft</span>
        ) : null}
      </div>
      {checks ? (
        <div className="flex h-7.5 items-center gap-control px-card pb-sm">
          <span className="flex size-5 shrink-0 items-center justify-center">
            {CHECK_ICON[pr.checks]}
          </span>
          <span className="flex-1 font-mono text-xs leading-sm text-text-secondary">
            Checks
          </span>
          <span className="font-mono text-2xs leading-xs text-text-tertiary">
            {checks}
          </span>
        </div>
      ) : null}
      <ChatCardFooter>
        <Button
          aria-disabled="true"
          title="Review comments are not available from the daemon yet. Reply on GitHub or send the Orchestrator a message."
          variant="primary"
        >
          Address with droids
        </Button>
        <Button
          data-testid="pr-refresh"
          disabled={sync.isPending}
          onClick={() => sync.mutate()}
          variant="secondary"
        >
          {sync.isPending ? "Refreshing…" : "Refresh status"}
        </Button>
        <span className="flex-1" />
        <Button asChild variant="ghost">
          <a href={pr.url} rel="noopener noreferrer" target="_blank">
            <ArrowUpRightIcon />
            Open PR
          </a>
        </Button>
      </ChatCardFooter>
    </ChatCard>
  );
};

const CleanupCard = () => {
  const { live, missionId } = useMission();
  const { mission } = live;
  const [always, setAlways] = useState(false);
  const cleanup = useFinishMutation(
    "Could not clean up the worktree",
    (input: { action: "keep" | "remove"; alwaysAfterMerge: boolean }) =>
      `cleanup:${input.action}`,
    (operationId, input) => api.cleanup(missionId, { ...input, operationId })
  );
  const { cleanup: state, cleanupReason } = mission.publish;
  if (state === "blocked") {
    return (
      <output className="text-xs leading-sm text-warning">
        The worktree was kept:{" "}
        {cleanupReason ?? "it has work that is not merged."}
      </output>
    );
  }
  if (state !== "eligible" || !mission.workspace?.owned) {
    return null;
  }
  const pending = cleanup.isPending ? cleanup.variables?.action : null;
  return (
    <ChatCard label="Remove the worktree" testId="cleanup-card">
      <div className="flex flex-col gap-lg p-card">
        <div className="flex items-start gap-control">
          <LayersIcon className="text-text-secondary" />
          <div className="flex min-w-0 flex-1 flex-col gap-xs">
            <h3 className="text-sm leading-sm font-medium tracking-tight text-text">
              Remove the worktree?
            </h3>
            <span className="truncate font-mono text-2xs leading-xs text-text-tertiary">
              {mission.workspace.path}
            </span>
            <p className="text-xs leading-sm font-book text-text-tertiary">
              The pull request is merged. Removing deletes the worktree and its
              local branch; nothing unmerged is removed.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-md">
          <Button
            data-testid="cleanup-remove"
            disabled={cleanup.isPending}
            onClick={() =>
              cleanup.mutate({ action: "remove", alwaysAfterMerge: always })
            }
            variant="primary"
          >
            {pending === "remove" ? "Removing…" : "Remove worktree"}
          </Button>
          <Button
            data-testid="cleanup-keep"
            disabled={cleanup.isPending}
            onClick={() =>
              cleanup.mutate({ action: "keep", alwaysAfterMerge: false })
            }
            variant="ghost"
          >
            Keep it
          </Button>
          <span className="flex-1" />
          <CheckboxRow
            checked={always}
            onChange={setAlways}
            testId="cleanup-always"
          >
            Always clean up after merge
          </CheckboxRow>
        </div>
      </div>
    </ChatCard>
  );
};

const STAT_LABELS = [
  "Duration",
  "Todos",
  "Agents",
  "Changes",
  "Files",
] as const;

const CompleteCard = ({ changes }: { changes: Changes | undefined }) => {
  const { live } = useMission();
  const { mission } = live;
  const groups = groupTodos(live.todos, live.agents);
  const todos =
    groups.main.length > 0 ? groups.main : Object.values(live.todos).flat();
  const done = todos.filter((todo) => todo.status === "completed").length;
  const status = displayStatus(live);
  const values: Record<(typeof STAT_LABELS)[number], string> = {
    Agents: String(Object.keys(live.agents).length),
    Changes: changes
      ? `+${changes.totals.additions} −${changes.totals.deletions}`
      : "—",
    Duration: formatDuration(
      Date.parse(mission.endedAt ?? mission.updatedAt) -
        Date.parse(mission.createdAt)
    ),
    Files: changes ? String(changes.totals.files) : "—",
    Todos: `${done} of ${todos.length}`,
  };
  return (
    <ChatCard label="Mission complete" testId="mission-complete">
      <ChatCardHeader
        icon={<CheckIcon className="text-success" />}
        status={
          status.label === "Done" ? { label: "Done", tone: "success" } : status
        }
      >
        Mission complete
      </ChatCardHeader>
      <dl className="flex max-md:grid max-md:grid-cols-3">
        {STAT_LABELS.map((label) => (
          <div
            className="flex min-w-0 flex-1 flex-col gap-xs px-card py-lg"
            key={label}
          >
            <dt className="text-xs leading-sm font-book tracking-tight text-text-tertiary">
              {label}
            </dt>
            <dd className="truncate text-base leading-lg font-semibold tracking-tight text-text">
              {values[label]}
            </dd>
          </div>
        ))}
      </dl>
      {mission.summary ? (
        <div className="border-t border-border-subtle px-card py-lg">
          <Markdown>{mission.summary}</Markdown>
        </div>
      ) : null}
    </ChatCard>
  );
};

const ArchiveRow = () => {
  const { applyLocal, live, missionId, refresh } = useMission();
  const ops = useOperationIds();
  const { revision, status } = live.mission;
  const archive = useSingleFlightMutation({
    mutationFn: () =>
      api.archiveMission(missionId, {
        expectedRevision: revision,
        operationId: ops.idFor(`archive:${revision}`),
      }),
    onError: (error) => {
      ops.release(error);
      reportMutationError(error, refresh, "Could not archive");
    },
    onSuccess: (value) => {
      ops.settle();
      applyLocal({ kind: "mission", value });
    },
  });
  if (!canArchive(status)) {
    return null;
  }
  return (
    <div className="flex items-center gap-md">
      <Button
        data-testid="archive-mission"
        disabled={archive.isPending}
        onClick={() => archive.mutate()}
        variant="secondary"
      >
        <DownloadIcon className="text-text-secondary" />
        {archive.isPending ? "Archiving…" : "Archive mission"}
      </Button>
      <Button asChild variant="ghost">
        <Link href="/">Start a follow-up mission</Link>
      </Button>
    </div>
  );
};

const PublishEvents = () => {
  const { live } = useMission();
  const { publish } = live.mission;
  const latest = publish.commits.at(-1);
  return (
    <>
      {latest ? (
        <EventLine icon={<CheckIcon />}>
          {latest.message.split("\n")[0]} · {publish.commits.length} commit
          {publish.commits.length === 1 ? "" : "s"} · {latest.sha.slice(0, 7)}
        </EventLine>
      ) : null}
      {publish.pushedBranch ? (
        <EventLine icon={<PullRequestIcon />}>
          Pushed {publish.pushedBranch}
          {publish.pr ? ` · opened ${prRef(publish.pr)}` : ""}
        </EventLine>
      ) : null}
      {publish.pr?.state === "merged" ? (
        <EventLine icon={<MergeIcon />}>
          {prRef(publish.pr)} merged into{" "}
          {live.mission.workspace?.baseRef ?? "main"}
        </EventLine>
      ) : null}
    </>
  );
};

/**
 * Paper SPM / TBH / TYS: the end of a mission. Shows the next publish step
 * (commit, push, PR), then the PR, cleanup, and archive actions.
 */
export const FinishFlow = () => {
  const { live, missionId } = useMission();
  const { mission } = live;
  const publishable = canArchive(mission.status);
  const changes = useChanges(
    missionId,
    live.workspaceSeq,
    publishable && mission.workspace !== null
  );
  if (!publishable) {
    return null;
  }
  const state = finishState(mission, changes.data);
  return (
    <>
      <PublishEvents />
      {mission.status === "completed" ? (
        <CompleteCard changes={changes.data} />
      ) : null}
      {state.step === "commit" && changes.data ? (
        <CommitCard
          changes={changes.data}
          pending={state.pending}
          preExisting={state.preExisting}
        />
      ) : null}
      {state.step === "push" ? (
        <PushCard head={changes.data?.head ?? null} />
      ) : null}
      {state.step === "pr" ? (
        <CreatePrCard head={changes.data?.head ?? null} />
      ) : null}
      {state.step === "review" ? <PrCard changes={changes.data} /> : null}
      <CleanupCard />
      <ArchiveRow />
    </>
  );
};
