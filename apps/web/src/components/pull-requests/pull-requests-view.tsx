"use client";

import type { PullRequestState } from "@missions/protocol/missions";
import Link from "next/link";

import { PageHeader, PageTitle } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import type { BadgeTone } from "@/components/ui/badge";
import { Callout } from "@/components/ui/callout";
import { Dot } from "@/components/ui/dot";
import { IconTile } from "@/components/ui/icon-tile";
import { PullRequestIcon } from "@/components/ui/icons";
import { ListCard, ListLabel, ListRow } from "@/components/ui/list-row";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api/api-error";
import { usePullRequestsQuery, useProjects } from "@/lib/api/queries";
import { shortAge } from "@/lib/format";
import { useNow } from "@/lib/use-now";

const MINUTE_MS = 60_000;

interface PullRequestRow {
  missionId: string;
  pr: PullRequestState;
  projectName: string;
  title: string;
}

const STATE_BADGE: Record<
  PullRequestState["state"],
  { label: string; tone: BadgeTone }
> = {
  closed: { label: "Closed", tone: "quiet" },
  merged: { label: "Merged", tone: "accent" },
  open: { label: "Open", tone: "success" },
};

const CHECKS: Record<
  PullRequestState["checks"],
  { label: string; tone: "danger" | "disabled" | "success" | "warning" } | null
> = {
  failing: { label: "Checks failing", tone: "danger" },
  none: null,
  passing: { label: "Checks passing", tone: "success" },
  pending: { label: "Checks running", tone: "warning" },
};

const usePullRequests = () => {
  const summaries = usePullRequestsQuery();
  const projects = useProjects();
  const names = new Map(
    (projects.data ?? []).map((project) => [project.id, project.name])
  );
  const rows: PullRequestRow[] = (summaries.data ?? []).map((summary) => ({
    missionId: summary.missionId,
    pr: summary.pr,
    projectName: names.get(summary.projectId) ?? "",
    title: summary.missionTitle,
  }));
  return {
    error: summaries.isError ? errorMessage(summaries.error) : null,
    loading: summaries.isPending,
    rows: rows.toSorted((a, b) => b.pr.updatedAt.localeCompare(a.pr.updatedAt)),
  };
};

const PullRequestItem = ({
  now,
  row,
}: {
  now: number;
  row: PullRequestRow;
}) => {
  const badge = row.pr.isDraft
    ? { label: "Draft", tone: "muted" as const }
    : STATE_BADGE[row.pr.state];
  const checks = CHECKS[row.pr.checks];
  return (
    <ListRow asChild size="group">
      <a href={row.pr.url} rel="noopener noreferrer" target="_blank">
        <PullRequestIcon />
        <span className="flex min-w-0 flex-1 flex-col gap-2xs">
          <span className="truncate text-text">{row.title}</span>
          <span className="flex min-w-0 items-center gap-sm text-xs leading-sm text-text-tertiary">
            <span className="truncate">{row.projectName}</span>
            <Dot size="separator" />
            <span className="font-mono">#{row.pr.number}</span>
            {checks ? (
              <>
                <Dot size="separator" />
                <Dot tone={checks.tone} />
                <span className="shrink-0">{checks.label}</span>
              </>
            ) : null}
          </span>
        </span>
        <Badge size="tag" tone={badge.tone}>
          {badge.label}
        </Badge>
        <span className="w-7 shrink-0 text-right text-xs leading-sm text-text-tertiary">
          {shortAge(row.pr.updatedAt, now)}
        </span>
      </a>
    </ListRow>
  );
};

const EmptyState = () => (
  <div className="flex flex-col items-center gap-xl px-3xl py-4xl text-center">
    <IconTile size="hero" tone="raised">
      <PullRequestIcon size="lg" tone="text" />
    </IconTile>
    <div className="flex flex-col items-center gap-sm">
      <p className="text-base leading-lg font-semibold tracking-tight text-text">
        No pull requests yet
      </p>
      <p className="max-w-105 text-sm leading-lg tracking-tight text-text-tertiary">
        When a mission publishes its work as a pull request, it shows up here
        with its review and check status.
      </p>
    </div>
    <Link
      className="rounded-xs text-sm leading-sm font-medium tracking-tight text-accent-text outline-none hover:underline focus-visible:shadow-focus"
      href="/"
    >
      Start a mission
    </Link>
  </div>
);

/** Every pull request opened by a mission, newest activity first. */
export const PullRequestsView = () => {
  const now = useNow(MINUTE_MS);
  const { error, loading, rows } = usePullRequests();
  const open = rows.filter((row) => row.pr.state === "open");
  const done = rows.filter((row) => row.pr.state !== "open");

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader>
        <PageTitle>Pull requests</PageTitle>
      </PageHeader>
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-lg pb-2xl md:px-3xl">
        <div className="flex w-full max-w-chat flex-col gap-2xl pt-xl">
          {loading && rows.length === 0 ? (
            <div className="flex flex-col gap-md">
              <Skeleton className="w-2/3" />
              <Skeleton className="w-1/2" />
              <Skeleton className="w-3/5" />
            </div>
          ) : null}
          {error ? (
            <Callout
              appearance="filled"
              role="alert"
              title="Could not load pull requests"
              tone="danger"
            >
              {error}
            </Callout>
          ) : null}
          {!error && !loading && rows.length === 0 ? <EmptyState /> : null}
          {open.length > 0 ? (
            <section className="flex flex-col">
              <ListLabel size="sidebar">Open · {open.length}</ListLabel>
              <ListCard>
                {open.map((row) => (
                  <PullRequestItem key={row.missionId} now={now} row={row} />
                ))}
              </ListCard>
            </section>
          ) : null}
          {done.length > 0 ? (
            <section className="flex flex-col">
              <ListLabel size="sidebar">Merged and closed</ListLabel>
              <ListCard>
                {done.map((row) => (
                  <PullRequestItem key={row.missionId} now={now} row={row} />
                ))}
              </ListCard>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
};
