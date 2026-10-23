"use client";

import type { CloneJob, CloneSource } from "@missions/protocol/projects";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { TerminalLine, TerminalLog } from "@/components/ui/code-block";
import { InlineCommand } from "@/components/ui/copy-button";
import {
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogSection,
  DialogTitle,
} from "@/components/ui/dialog";
import { CheckIcon, ChevronRightIcon, CopyIcon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/progress";
import { Step, StepList } from "@/components/ui/step-list";
import type { StepState } from "@/components/ui/step-list";
import { Hint } from "@/components/ui/tooltip";
import { errorMessage } from "@/lib/api/api-error";
import { useCloneJob } from "@/lib/api/queries";
import { tildePath } from "@/lib/format";
import { useNow } from "@/lib/use-now";

import { cloneCommand, repoNameOf, sourceLabel } from "./clone-target";
import { useHomeDir } from "./use-home-dir";

type CloneErrorCode = NonNullable<CloneJob["error"]>["code"];

const PROGRESS_LINE =
  /^(?:remote: )?(?<phase>[A-Z][\w ]+?):\s+(?<percent>\d+)% \((?<done>\d+)\/(?<total>\d+)\)(?:, (?<size>[\d.]+ \w+) \| (?<rate>[\d.]+ \w+\/s))?/u;
const REMOTE_LINE = /^remote: /u;
const CLONING_INTO = /^Cloning into /u;
const CHECKOUT_PHASE = /^(?:Resolving deltas|Updating files|Checking out)/u;
const MAX_LOG_LINES = 5;
const MS_PER_SECOND = 1000;

interface Progress {
  done: number;
  percent: number;
  phase: string;
  rate: string | null;
  size: string | null;
  total: number;
}

const parseProgress = (line: string | null): Progress | null => {
  const groups = line ? PROGRESS_LINE.exec(line)?.groups : undefined;
  if (!groups) {
    return null;
  }
  return {
    done: Number(groups.done ?? 0),
    percent: Number(groups.percent ?? 0),
    phase: groups.phase ?? "",
    rate: groups.rate ?? null,
    size: groups.size ?? null,
    total: Number(groups.total ?? 0),
  };
};

/** 0 connecting, 1 receiving, 2 checking out, 3 reading the project. */
const stageOf = (job: CloneJob | undefined, progress: Progress | null) => {
  if (job?.status === "succeeded") {
    return 3;
  }
  if (progress && CHECKOUT_PHASE.test(progress.phase)) {
    return 2;
  }
  if (progress || (job?.progress && REMOTE_LINE.test(job.progress))) {
    return 1;
  }
  return 0;
};

interface Timeline {
  lines: readonly string[];
  stage: number;
  starts: readonly number[];
}

const logKey = (line: string) => parseProgress(line)?.phase ?? line;

const appendLine = (lines: readonly string[], line: string) => {
  const key = logKey(line);
  const kept = lines.filter((existing) => logKey(existing) !== key);
  return [...kept, line].slice(-MAX_LOG_LINES);
};

/** Remembers when each stage began and the recent distinct progress lines. */
const useTimeline = (stage: number, line: string | null, now: number) => {
  const [timeline, setTimeline] = useState<Timeline>({
    lines: [],
    stage: 0,
    starts: [now],
  });
  const lineChanged =
    line !== null && !CLONING_INTO.test(line) && line !== timeline.lines.at(-1);
  if (stage > timeline.stage || lineChanged) {
    const starts = [...timeline.starts];
    for (let index = timeline.stage + 1; index <= stage; index += 1) {
      starts[index] = now;
    }
    setTimeline({
      lines: lineChanged ? appendLine(timeline.lines, line) : timeline.lines,
      stage: Math.max(stage, timeline.stage),
      starts,
    });
  }
  return timeline;
};

const seconds = (ms: number, precise: boolean) =>
  precise
    ? `${(ms / MS_PER_SECOND).toFixed(1)}s`
    : `${Math.floor(ms / MS_PER_SECOND)}s`;

const stepState = (index: number, stage: number): StepState => {
  if (index < stage) {
    return "done";
  }
  return index === stage ? "active" : "pending";
};

const connectLabel = (source: CloneSource, done: boolean) => {
  if (source.kind === "github") {
    return done ? "Authenticated with gh" : "Authenticating with gh";
  }
  return done ? "Connected to remote" : "Connecting to remote";
};

const formatCount = (value: number) => value.toLocaleString("en-US");

const ProgressSummary = ({ progress }: { progress: Progress | null }) => (
  <div className="flex flex-col gap-md">
    <div className="flex items-center">
      <p className="min-w-0 flex-1 text-sm leading-sm font-medium tracking-tight text-text">
        {progress?.phase ?? "Connecting"}
      </p>
      <span className="font-mono text-xs leading-xs text-text-secondary">
        {progress ? `${progress.percent}%` : ""}
      </span>
    </div>
    <ProgressBar label="Clone progress" value={progress?.percent ?? 0} />
    <div className="flex items-center gap-md">
      <p className="min-w-0 flex-1 text-xs leading-sm tracking-tight text-text-tertiary">
        {progress
          ? `${formatCount(progress.done)} of ${formatCount(progress.total)} objects`
          : "Waiting for the remote…"}
      </p>
      {progress?.size ? (
        <span className="font-mono text-xs leading-xs text-text-tertiary">
          {progress.rate
            ? `${progress.size} · ${progress.rate}`
            : progress.size}
        </span>
      ) : null}
    </div>
  </div>
);

const Cloning = ({
  destination,
  job,
  source,
}: {
  destination: string;
  job: CloneJob | undefined;
  source: CloneSource;
}) => {
  const now = useNow();
  const progress = parseProgress(job?.progress ?? null);
  const stage = stageOf(job, progress);
  const timeline = useTimeline(stage, job?.progress ?? null, now);
  const metaFor = (index: number) => {
    const start = timeline.starts[index];
    if (start === undefined || index > timeline.stage) {
      return;
    }
    const end = timeline.starts[index + 1] ?? now;
    return seconds(end - start, index < timeline.stage);
  };
  const labels = [
    connectLabel(source, stage > 0),
    "Receiving objects",
    "Checking out files",
    "Reading the project",
  ];

  return (
    <>
      <DialogSection padding="form">
        <ProgressSummary progress={progress} />
        <StepList>
          {labels.map((label, index) => (
            <Step
              key={label}
              label={label}
              meta={
                index === 3 && stage < 3
                  ? "setup, tests, scripts"
                  : metaFor(index)
              }
              state={stepState(index, stage)}
            />
          ))}
        </StepList>
        <TerminalLog aria-live="polite">
          <TerminalLine>Cloning into &apos;{destination}&apos;...</TerminalLine>
          {timeline.lines.map((line, index) => (
            <TerminalLine
              key={logKey(line)}
              tone={index === timeline.lines.length - 1 ? "current" : "muted"}
            >
              {line}
            </TerminalLine>
          ))}
        </TerminalLog>
      </DialogSection>
      <DialogFooter>
        <span className="text-xs leading-sm tracking-tight text-text-tertiary">
          Keeps going if you close this
        </span>
        <span className="flex-1" />
        <Hint label="The daemon can’t stop a clone once it starts">
          <span className="inline-flex">
            <Button disabled variant="secondary">
              Cancel clone
            </Button>
          </span>
        </Hint>
        <DialogClose asChild>
          <Button variant="ghost">Hide</Button>
        </DialogClose>
      </DialogFooter>
    </>
  );
};

const FAILURE_LABEL: Record<CloneErrorCode, string> = {
  auth_required: "sign-in required",
  destination_exists: "folder already exists",
  failed: "git exited with an error",
  gh_missing: "gh not installed",
  network: "remote unreachable",
  not_found: "repository not found",
};

const failureSummary = (
  code: CloneErrorCode,
  source: CloneSource,
  user: string | null,
  destination: string
) => {
  switch (code) {
    case "not_found": {
      return source.kind === "github"
        ? `Repository not found, or ${user ?? "your account"} doesn’t have access.`
        : "Repository not found at that URL.";
    }
    case "auth_required": {
      return "The remote needs you to sign in before it shares this repository.";
    }
    case "destination_exists": {
      return `${destination} already exists.`;
    }
    case "network": {
      return "Couldn’t reach the remote.";
    }
    case "gh_missing": {
      return "The GitHub CLI (gh) isn’t installed on this machine.";
    }
    default: {
      return "git stopped before the clone finished.";
    }
  }
};

interface Tip {
  command?: string;
  text: string;
}

const tipsFor = (code: CloneErrorCode, source: CloneSource): Tip[] => {
  const owner =
    source.kind === "github" ? (source.repo.split("/")[0] ?? "") : "";
  switch (code) {
    case "not_found": {
      return source.kind === "github"
        ? [
            { text: "Open the repo on GitHub and confirm you can see it." },
            {
              command: "gh auth refresh -s repo",
              text: "Your gh token may be missing the repo scope.",
            },
            {
              command: "gh auth refresh -h github.com",
              text: `If ${owner} uses SSO, authorize the token for the org.`,
            },
          ]
        : [
            { text: "Check the URL for typos." },
            {
              command: `git ls-remote ${source.url}`,
              text: "Confirm your credentials can read it.",
            },
          ];
    }
    case "auth_required": {
      return source.kind === "github"
        ? [
            {
              command: "gh auth login",
              text: "Sign in to the GitHub CLI, then try again.",
            },
          ]
        : [
            {
              command: "ssh-add -l",
              text: "For SSH remotes, check that your key is loaded.",
            },
          ];
    }
    case "destination_exists": {
      return [
        { text: "Add the existing folder as a local project instead." },
        { text: "Or go back and choose another folder to clone into." },
      ];
    }
    case "network": {
      return [
        { text: "Check your connection, VPN, or proxy, then try again." },
      ];
    }
    case "gh_missing": {
      return [
        { command: "brew install gh", text: "Install the GitHub CLI." },
        { command: "gh auth login", text: "Then sign in once." },
      ];
    }
    default: {
      return [{ text: "Read the git output above for the cause." }];
    }
  }
};

const CopyErrorButton = ({ value }: { value: string }) => {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Button className="-ml-lg" onClick={copy} variant="link">
      {copied ? <CheckIcon size="sm" tone="success" /> : <CopyIcon size="sm" />}
      {copied ? "Copied" : "Copy error"}
    </Button>
  );
};

const Failed = ({
  destination,
  error,
  onBack,
  onRetry,
  retryError,
  retrying,
  source,
  user,
}: {
  user: string | null;
  destination: string;
  error: CloneJob["error"];
  onBack: () => void;
  onRetry: () => void;
  retryError: string | null;
  retrying: boolean;
  source: CloneSource;
}) => {
  const code = error?.code ?? "failed";
  const command = cloneCommand(source, destination);
  const output = (error?.message ?? "").split("\n").filter(Boolean);
  return (
    <>
      <DialogSection padding="report">
        <Callout
          appearance="strip"
          role="alert"
          title={failureSummary(code, source, user, destination)}
          tone="danger"
        />
        <TerminalLog>
          <TerminalLine>$ {command}</TerminalLine>
          {output.map((line) => (
            <TerminalLine key={line} tone="danger">
              {line}
            </TerminalLine>
          ))}
        </TerminalLog>
        <div className="flex flex-col">
          <p className="pb-sm text-xs leading-sm font-medium tracking-tight text-text-tertiary">
            Things to try
          </p>
          {tipsFor(code, source).map((tip) => (
            <div
              className="flex items-start gap-control border-t border-border-subtle py-md"
              key={tip.text}
            >
              <ChevronRightIcon size="sm" tone="tertiary" />
              <div className="flex min-w-0 flex-1 flex-col gap-sm">
                <p className="text-sm leading-sm tracking-tight text-text-secondary">
                  {tip.text}
                </p>
                {tip.command ? <InlineCommand value={tip.command} /> : null}
              </div>
            </div>
          ))}
        </div>
        {retryError ? (
          <Callout appearance="strip" title={retryError} tone="danger" />
        ) : null}
      </DialogSection>
      <DialogFooter>
        <CopyErrorButton value={[`$ ${command}`, ...output].join("\n")} />
        <span className="flex-1" />
        <Button onClick={onBack} variant="ghost">
          Back
        </Button>
        <Button disabled={retrying} onClick={onRetry} variant="primary">
          {retrying ? "Retrying…" : "Try again"}
        </Button>
      </DialogFooter>
    </>
  );
};

const CloneHeader = ({
  destination,
  failure,
  source,
}: {
  destination: string;
  failure: CloneErrorCode | null;
  source: CloneSource;
}) => {
  const name = repoNameOf(source);
  return (
    <DialogHeader>
      <DialogTitle>
        {failure ? `Couldn’t clone ${name}` : `Cloning ${name}`}
      </DialogTitle>
      <DialogDescription>
        {failure
          ? `${sourceLabel(source)} · ${FAILURE_LABEL[failure]}`
          : `${sourceLabel(source)} → ${destination || "…"}`}
      </DialogDescription>
    </DialogHeader>
  );
};

interface CloneProgressProps {
  jobId: string;
  onBack: () => void;
  onRetry: () => void;
  retryError: string | null;
  retrying: boolean;
  source: CloneSource;
  user: string | null;
}

/** NZJ while cloning, OBV on failure; hands off to OZS on success. */
export const CloneProgress = ({
  jobId,
  onBack,
  onRetry,
  retryError,
  retrying,
  source,
  user,
}: CloneProgressProps) => {
  const home = useHomeDir();
  const job = useCloneJob(jobId);
  const destination = job.data ? tildePath(job.data.destination, home) : "";
  const failed = job.data?.status === "failed";
  const lost = job.isError && !job.data;

  return (
    <>
      <CloneHeader
        destination={destination}
        failure={failed ? (job.data?.error?.code ?? "failed") : null}
        source={source}
      />
      {lost ? (
        <DialogSection padding="form">
          <Callout
            actions={
              <Button onClick={() => job.refetch()} variant="secondary">
                Check again
              </Button>
            }
            appearance="filled"
            title="Lost track of the clone"
            tone="danger"
          >
            {errorMessage(job.error)}
          </Callout>
        </DialogSection>
      ) : null}
      {failed ? (
        <Failed
          destination={destination}
          error={job.data?.error ?? null}
          onBack={onBack}
          onRetry={onRetry}
          retryError={retryError}
          retrying={retrying}
          source={source}
          user={user}
        />
      ) : null}
      {failed || lost ? null : (
        <Cloning
          destination={job.data?.destination ?? ""}
          job={job.data}
          source={source}
        />
      )}
    </>
  );
};
