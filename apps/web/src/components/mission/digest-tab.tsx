"use client";

import { useMemo } from "react";
import type { ReactNode } from "react";

import {
  CheckIcon,
  FileTextIcon,
  PullRequestIcon,
} from "@/components/mission/icons";
import { useMission } from "@/components/mission/mission-context";
import { DotLoader, Meta, PanelSection } from "@/components/mission/panel-kit";
import { usePermissionDecision } from "@/components/mission/use-permission-decision";
import { Markdown } from "@/components/ui/markdown";
import { shortAge } from "@/lib/format";
import { buildDigest } from "@/lib/mission/digest";
import type { DigestItem, DigestNeed } from "@/lib/mission/digest";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

const Age = ({ at }: { at: string }) => {
  const now = useNow();
  return <Meta className="leading-sm">{shortAge(at, now)}</Meta>;
};

const smallButton =
  "flex h-6.5 cursor-pointer items-center rounded-sm px-control text-xs leading-sm font-medium tracking-tight transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-disabled";

const NeedActions = ({ need }: { need: DigestNeed }) => {
  const { live, showAgent } = useMission();
  const decide = usePermissionDecision(
    need.kind === "permission" ? need.request : null
  );
  if (need.kind === "permission") {
    return (
      <div className="mt-md flex gap-sm">
        <button
          className={cn(
            smallButton,
            "bg-accent text-on-accent hover:bg-accent-hover"
          )}
          disabled={decide.isPending}
          onClick={() => decide.mutate("approve_once")}
          type="button"
        >
          Allow once
        </button>
        <button
          className={cn(
            smallButton,
            "bg-surface-active text-text shadow-button hover:bg-surface-overlay"
          )}
          disabled={decide.isPending}
          onClick={() => decide.mutate("deny")}
          type="button"
        >
          Deny
        </button>
      </div>
    );
  }
  const target = need.kind === "plan" ? "plan-card" : "question-card";
  return (
    <div className="mt-md flex gap-sm">
      <button
        className={cn(
          smallButton,
          "bg-accent text-on-accent hover:bg-accent-hover"
        )}
        onClick={() => {
          const agentId =
            need.kind === "question"
              ? need.question.agentId
              : Object.values(live.agents).find(
                  (agent) => agent.role === "orchestrator"
                )?.id;
          if (agentId) {
            showAgent(agentId);
          }
          requestAnimationFrame(() =>
            document
              .querySelector(`[data-testid="${target}"]`)
              ?.scrollIntoView({ behavior: "smooth", block: "center" })
          );
        }}
        type="button"
      >
        {need.kind === "plan" ? "Review plan" : "Answer"}
      </button>
    </div>
  );
};

const needText = (
  need: DigestNeed,
  labels: Record<string, string>
): { detail: string; title: string } => {
  if (need.kind === "plan") {
    return {
      detail: "The orchestrator is waiting for you to approve the plan.",
      title: need.plan.title,
    };
  }
  if (need.kind === "question") {
    const [first] = need.question.questions;
    return {
      detail: `${labels[need.question.agentId] ?? "An agent"} asked ${need.question.questions.length} question${need.question.questions.length === 1 ? "" : "s"}.`,
      title: first?.question ?? "A question for you",
    };
  }
  const summary =
    need.request.toolUses.map((use) => use.summary).join(", ") || "an action";
  return {
    detail: need.request.reason ?? `Wants to run ${summary}.`,
    title:
      need.request.kind === "publish"
        ? "Allow publishing?"
        : `Allow ${need.request.toolUses[0]?.toolName ?? "this action"}?`,
  };
};

const NeedCard = ({ need }: { need: DigestNeed }) => {
  const { agentLabels } = useMission();
  const { detail, title } = needText(need, agentLabels);
  return (
    <li className="flex gap-control rounded-md bg-surface-raised px-md py-lg shadow-sm">
      <span className="flex h-4 w-5 shrink-0 items-center justify-center">
        <span className="size-2 rounded-full bg-warning" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-xs">
        <span className="text-sm leading-sm font-medium tracking-tight text-text">
          {title}
        </span>
        <Markdown appearance="panel">{detail}</Markdown>
        <NeedActions need={need} />
      </div>
      <Age at={need.at} />
    </li>
  );
};

const ITEM_ICON: Record<DigestItem["icon"], ReactNode> = {
  done: <CheckIcon className="text-success" />,
  file: <FileTextIcon className="text-text-secondary" />,
  pr: <PullRequestIcon className="text-success" />,
  working: <DotLoader label="Working" tone="accent" />,
};

const ItemRow = ({ item }: { item: DigestItem }) => (
  <li className="flex gap-control rounded-md px-md py-control">
    <span className="flex h-4 w-5 shrink-0 items-center justify-center">
      {ITEM_ICON[item.icon]}
    </span>
    <div className="flex min-w-0 flex-1 flex-col gap-xs">
      <span className="text-sm leading-sm font-medium tracking-tight text-text">
        {item.title}
      </span>
      <Markdown appearance="panel">{item.detail}</Markdown>
    </div>
    <Age at={item.at} />
  </li>
);

/** Paper GDH: Needs you, New, In progress. */
export const DigestTab = () => {
  const { agentLabels, live } = useMission();
  const digest = useMemo(
    () =>
      buildDigest({
        agents: live.agents,
        artifacts: live.artifacts,
        assignments: live.assignments,
        labels: agentLabels,
        mission: live.mission,
        permissions: live.permissions,
        plans: live.plans,
        questions: live.questions,
        todos: live.todos,
      }),
    [agentLabels, live]
  );
  const empty =
    digest.needsYou.length + digest.recent.length + digest.inProgress.length ===
    0;
  if (empty) {
    return (
      <p className="text-xs leading-sm text-text-tertiary">
        Decisions, finished work, and running assignments collect here.
      </p>
    );
  }
  return (
    <>
      {digest.needsYou.length > 0 ? (
        <PanelSection count={digest.needsYou.length} title="Needs you">
          <ul className="-mx-md flex flex-col gap-2xs">
            {digest.needsYou.map((need) => (
              <NeedCard key={need.id} need={need} />
            ))}
          </ul>
        </PanelSection>
      ) : null}
      {digest.recent.length > 0 ? (
        <PanelSection count={digest.recent.length} title="New">
          <ul className="-mx-md flex flex-col gap-2xs">
            {digest.recent.map((item) => (
              <ItemRow item={item} key={item.id} />
            ))}
          </ul>
        </PanelSection>
      ) : null}
      {digest.inProgress.length > 0 ? (
        <PanelSection count={digest.inProgress.length} title="In progress">
          <ul className="-mx-md flex flex-col gap-2xs">
            {digest.inProgress.map((item) => (
              <ItemRow item={item} key={item.id} />
            ))}
          </ul>
        </PanelSection>
      ) : null}
    </>
  );
};
