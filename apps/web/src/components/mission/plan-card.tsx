"use client";

import type { PlanRevision } from "@missions/protocol/missions";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import {
  ChatCard,
  ChatCardFooter,
  ChatCardHeader,
} from "@/components/mission/chat-cards";
import { ClipboardIcon } from "@/components/mission/icons";
import { useMission } from "@/components/mission/mission-context";
import { reportMutationError } from "@/components/mission/report-error";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleRow,
} from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/input";
import { Markdown } from "@/components/ui/markdown";
import { api } from "@/lib/api/endpoints";
import { useModelName } from "@/lib/api/queries";
import { groupTodos } from "@/lib/mission/overview";
import { parsePlan } from "@/lib/mission/plan";

const plural = (count: number, one: string) =>
  `${count} ${count === 1 ? one : `${one}s`}`;

const PlanReview = ({ plan }: { plan: PlanRevision }) => {
  const { applyLocal, missionId, refresh } = useMission();
  const [revising, setRevising] = useState(false);
  const [feedback, setFeedback] = useState("");
  const decide = useMutation({
    mutationFn: (input: { approve: boolean; feedback?: string }) =>
      api.decidePlan(missionId, { ...input, planRevision: plan.revision }),
    onError: (error) =>
      reportMutationError(error, refresh, "Could not send your decision"),
    onSuccess: (value) => {
      setRevising(false);
      setFeedback("");
      applyLocal({ kind: "plan", value });
    },
  });

  if (revising) {
    return (
      <ChatCardFooter>
        <form
          className="flex w-full flex-col gap-md"
          onSubmit={(event) => {
            event.preventDefault();
            if (feedback.trim()) {
              decide.mutate({ approve: false, feedback: feedback.trim() });
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
        onClick={() => decide.mutate({ approve: true })}
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
  const todoCount = groupTodos(live.todos, live.agents).main.length;
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

/** Paper RHI plan card. Only the latest proposed revision can be approved. */
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
            Plan revision {plan.revision} · {NOTES[plan.status].toLowerCase()}
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
  return (
    <ChatCard label={`Plan: ${plan.title || "Plan"}`} testId="plan-card">
      <ChatCardHeader
        icon={<ClipboardIcon className="size-4 text-text-secondary" />}
        note={
          plan.revision > 1
            ? `Revision ${plan.revision} · ${NOTES[plan.status]}`
            : NOTES[plan.status]
        }
      >
        Plan
      </ChatCardHeader>
      <PlanBody plan={plan} />
      {plan.status === "proposed" ? <PlanReview plan={plan} /> : null}
    </ChatCard>
  );
};
