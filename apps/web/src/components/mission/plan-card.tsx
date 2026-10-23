"use client";

import type { PlanRevision } from "@missions/protocol/missions";
import { useState } from "react";

import {
  ChatCard,
  ChatCardFooter,
  ChatCardHeader,
} from "@/components/mission/chat-cards";
import { ClipboardIcon } from "@/components/mission/icons";
import { useMission } from "@/components/mission/mission-context";
import { useMissionCommand } from "@/components/mission/use-mission-command";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleRow,
} from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/input";
import { Markdown } from "@/components/ui/markdown";
import { useModelName } from "@/lib/api/queries";
import { todoProgress } from "@/lib/mission/overview";
import { parsePlan } from "@/lib/mission/plan";

const plural = (count: number, one: string) =>
  `${count} ${count === 1 ? one : `${one}s`}`;

const PlanReview = ({ plan }: { plan: PlanRevision }) => {
  const [revising, setRevising] = useState(false);
  const [feedback, setFeedback] = useState("");
  const decide = useMissionCommand(
    "plan",
    "Could not send your decision",
    () => {
      setRevising(false);
      setFeedback("");
    }
  );

  if (revising) {
    return (
      <ChatCardFooter>
        <form
          className="flex w-full flex-col gap-md"
          onSubmit={(event) => {
            event.preventDefault();
            if (feedback.trim()) {
              decide.mutate({
                approve: false,
                feedback: feedback.trim(),
                planRevision: plan.revision,
              });
            }
          }}
        >
          <Textarea
            aria-label="What should change in the plan?"
            onChange={(event) => setFeedback(event.target.value)}
            placeholder="What should change? The Orchestrator revises the plan and asks again."
            value={feedback}
          />
          <div className="flex justify-end gap-md">
            <Button onClick={() => setRevising(false)} variant="ghost">
              Cancel
            </Button>
            <Button
              disabled={!feedback.trim() || decide.isPending}
              type="submit"
              variant="primary"
            >
              {decide.isPending ? "Sending…" : "Send feedback"}
            </Button>
          </div>
        </form>
      </ChatCardFooter>
    );
  }

  return (
    <ChatCardFooter>
      <Button
        data-testid="plan-approve"
        disabled={decide.isPending}
        onClick={() =>
          decide.mutate({ approve: true, planRevision: plan.revision })
        }
        variant="primary"
      >
        {decide.isPending ? "Approving…" : "Approve and start"}
      </Button>
      <Button
        disabled={decide.isPending}
        onClick={() => setRevising(true)}
        variant="secondary"
      >
        Keep planning
      </Button>
    </ChatCardFooter>
  );
};

const PlanBody = ({ plan }: { plan: PlanRevision }) => {
  const { live } = useMission();
  const orchestratorModel = useModelName(live.mission.orchestrator.modelId);
  const workerModel = useModelName(live.mission.worker.modelId);
  const parsed = parsePlan(plan.markdown);
  const todoCount = todoProgress(live.todos, live.agents).total;
  const counts = [
    parsed ? plural(parsed.steps.length, "step") : null,
    (plan.status === "approved" || plan.status === "proposed") && todoCount > 0
      ? plural(todoCount, "todo")
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex flex-col gap-control p-card">
      {parsed ? (
        <>
          <p className="text-sm leading-chat font-book tracking-tight text-text">
            {parsed.summary || plan.title}
          </p>
          <ol className="flex flex-col">
            {parsed.steps.map((step, index) => (
              <li
                className="flex gap-control py-sm"
                key={`${index}-${step.title}`}
              >
                <span className="w-xl shrink-0 font-mono text-xs leading-lg font-book text-text-tertiary">
                  {index + 1}.
                </span>
                <span className="flex min-w-0 flex-col gap-2xs">
                  <span className="text-sm leading-lg font-medium tracking-tight text-text">
                    {step.title}
                  </span>
                  {step.detail ? (
                    <span className="text-xs leading-sm font-book tracking-tight text-text-tertiary">
                      {step.detail}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <Markdown>{plan.markdown}</Markdown>
      )}
      <p className="flex flex-wrap items-center gap-x-xl gap-y-xs pt-xs text-xs leading-sm font-book tracking-tight text-text-tertiary">
        {counts ? <span>{counts}</span> : null}
        <span>Orchestrator · {orchestratorModel}</span>
        <span>Workers · {workerModel}</span>
      </p>
      {plan.feedback ? (
        <p className="text-xs leading-sm font-book tracking-tight text-text-tertiary">
          Your feedback: {plan.feedback}
        </p>
      ) : null}
    </div>
  );
};

const NOTES: Record<PlanRevision["status"], string> = {
  approved: "Approved",
  proposed: "Waiting for your approval",
  rejected: "Sent back for changes",
  superseded: "Superseded",
};

/** Approval binds to a live native request; without one the card is a record. */
const isActionable = (plan: PlanRevision) =>
  plan.actionable && plan.status === "proposed";

const noteFor = (plan: PlanRevision) =>
  plan.status === "proposed" && !plan.actionable
    ? "Approval ended"
    : NOTES[plan.status];

const ApprovalEnded = () => (
  <ChatCardFooter>
    <p
      className="text-xs leading-sm font-book tracking-tight text-text-tertiary"
      data-testid="plan-not-actionable"
    >
      Approval ended when the mission stopped; the agent will present it again
      after Resume.
    </p>
  </ChatCardFooter>
);

/**
 * Paper RHI plan card. Only the latest proposed revision with a live native
 * approval request can be approved or sent back.
 */
export const PlanCard = ({
  latest,
  plan,
}: {
  latest: boolean;
  plan: PlanRevision;
}) => {
  if (!latest) {
    return (
      <Collapsible>
        <CollapsibleRow>
          <ClipboardIcon className="size-3.5" />
          <span className="truncate">
            Plan revision {plan.revision} · {noteFor(plan).toLowerCase()}
          </span>
        </CollapsibleRow>
        <CollapsibleContent>
          <div className="rounded-md bg-surface-raised shadow-sm">
            <PlanBody plan={plan} />
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  }
  const note = noteFor(plan);
  let footer = null;
  if (isActionable(plan)) {
    footer = <PlanReview plan={plan} />;
  } else if (plan.status === "proposed") {
    footer = <ApprovalEnded />;
  }
  return (
    <ChatCard label={`Plan: ${plan.title || "Plan"}`} testId="plan-card">
      <ChatCardHeader
        icon={<ClipboardIcon className="size-4 text-text-secondary" />}
        note={plan.revision > 1 ? `Revision ${plan.revision} · ${note}` : note}
      >
        Plan
      </ChatCardHeader>
      <PlanBody plan={plan} />
      {footer}
    </ChatCard>
  );
};
