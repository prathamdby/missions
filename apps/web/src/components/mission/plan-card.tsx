"use client";

import type { PlanRevision } from "@missions/protocol/missions";
import { useMutation } from "@tanstack/react-query";
import { CheckIcon, FileTextIcon } from "lucide-react";
import { useState } from "react";

import { useMission } from "@/components/mission/mission-context";
import { reportMutationError } from "@/components/mission/report-error";
import { Badge, Tag } from "@/components/ui/badge";
import type { BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleRow,
} from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/input";
import { Markdown } from "@/components/ui/markdown";
import { api } from "@/lib/api/endpoints";

const STATUS: Record<
  PlanRevision["status"],
  { label: string; tone: BadgeTone }
> = {
  approved: { label: "Approved", tone: "success" },
  proposed: { label: "Waiting for you", tone: "warning" },
  rejected: { label: "Sent back", tone: "muted" },
  superseded: { label: "Superseded", tone: "quiet" },
};

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
      <CardFooter>
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
      </CardFooter>
    );
  }

  return (
    <CardFooter>
      <Button
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
    </CardFooter>
  );
};

const PlanBody = ({ plan }: { plan: PlanRevision }) => (
  <CardContent>
    <Markdown>{plan.markdown}</Markdown>
    {plan.feedback ? (
      <p className="type-caption text-text-tertiary">
        Your feedback: {plan.feedback}
      </p>
    ) : null}
  </CardContent>
);

/** Plan revision. Only the latest proposed revision can be approved. */
export const PlanCard = ({
  latest,
  plan,
}: {
  latest: boolean;
  plan: PlanRevision;
}) => {
  const status = STATUS[plan.status];
  if (!latest) {
    return (
      <Collapsible>
        <CollapsibleRow>
          <FileTextIcon aria-hidden="true" />
          <span className="truncate">
            Plan revision {plan.revision} · {status.label.toLowerCase()}
          </span>
        </CollapsibleRow>
        <CollapsibleContent>
          <Card tone="inset">
            <PlanBody plan={plan} />
          </Card>
        </CollapsibleContent>
      </Collapsible>
    );
  }
  return (
    <Card aria-label={`Plan: ${plan.title}`}>
      <CardHeader>
        <FileTextIcon
          aria-hidden="true"
          className="size-4 shrink-0 text-text-secondary"
        />
        <CardTitle>{plan.title || "Plan"}</CardTitle>
        <Tag>r{plan.revision}</Tag>
        <Badge dot tone={status.tone}>
          {status.label}
        </Badge>
      </CardHeader>
      <PlanBody plan={plan} />
      {plan.status === "proposed" ? <PlanReview plan={plan} /> : null}
      {plan.status === "approved" ? (
        <CardFooter>
          <p className="flex items-center gap-sm type-caption text-text-tertiary">
            <CheckIcon aria-hidden="true" className="size-3.5" />
            Plan approved. Workers build from this revision.
          </p>
        </CardFooter>
      ) : null}
    </Card>
  );
};
