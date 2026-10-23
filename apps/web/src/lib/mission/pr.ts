import type { PullRequestState } from "@missions/protocol/missions";

const PR_URL = /github\.com\/[^/]+\/(?<repo>[^/]+)\/pull\/\d+/u;

/** "pr-agent#812" from the PR URL; falls back to "#812". */
export const prRef = (pr: Pick<PullRequestState, "number" | "url">) => {
  const repo = PR_URL.exec(pr.url)?.groups?.repo;
  return repo ? `${repo}#${pr.number}` : `#${pr.number}`;
};

const CHECKS: Record<PullRequestState["checks"], string | null> = {
  failing: "checks failing",
  none: null,
  passing: "checks passing",
  pending: "checks running",
};

export const checksLabel = (checks: PullRequestState["checks"]) =>
  CHECKS[checks];

const EFFORT_LABEL: Record<string, string> = {
  dynamic: "Dynamic",
  high: "High",
  low: "Low",
  max: "Max",
  medium: "Medium",
  minimal: "Minimal",
  none: "None",
  off: "Off",
  xhigh: "Extra high",
};

export const effortLabel = (effort: string | null) =>
  effort ? (EFFORT_LABEL[effort] ?? effort) : "Default";
