"use client";

import type {
  PermissionDecision,
  PermissionRequest,
} from "@missions/protocol/missions";
import { useMutation } from "@tanstack/react-query";
import { CheckIcon, ShieldIcon, XIcon } from "lucide-react";

import { useMission } from "@/components/mission/mission-context";
import { reportMutationError } from "@/components/mission/report-error";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CodeBlock } from "@/components/ui/code-block";
import { api } from "@/lib/api/endpoints";

const titleOf = (request: PermissionRequest) => {
  if (request.kind === "publish") {
    return "Allow publishing?";
  }
  const [first] = request.toolUses;
  if (request.toolUses.length === 1 && first) {
    return first.toolName === "Execute"
      ? "Allow this command?"
      : `Allow ${first.toolName}?`;
  }
  return `Allow ${request.toolUses.length} actions?`;
};

const summaryOf = (request: PermissionRequest) =>
  request.toolUses.map((use) => use.summary).join(", ") || "this action";

const ResolvedPermission = ({ request }: { request: PermissionRequest }) => {
  let text = "Request expired before a decision";
  let icon = <XIcon aria-hidden="true" className="size-3.5 shrink-0" />;
  if (request.status === "approved") {
    text =
      request.decision === "always_allow"
        ? "You always allowed"
        : "You allowed";
    icon = <CheckIcon aria-hidden="true" className="size-3.5 shrink-0" />;
  } else if (request.status === "denied") {
    text = "You denied";
  }
  return (
    <p className="flex min-w-0 items-center gap-sm type-caption text-text-tertiary">
      {icon}
      <span className="shrink-0">{text}</span>
      <span className="truncate font-mono text-xs">{summaryOf(request)}</span>
    </p>
  );
};

/** Pending tool or publish gate with Allow once / Always allow / Deny. */
export const PermissionCard = ({ request }: { request: PermissionRequest }) => {
  const { agentLabels, applyLocal, missionId, refresh } = useMission();
  const decide = useMutation({
    mutationFn: (decision: PermissionDecision) =>
      api.decidePermission(missionId, request.id, {
        decision,
        epoch: request.epoch,
      }),
    onError: (error) =>
      reportMutationError(error, refresh, "Could not send your decision"),
    onSuccess: (value) => applyLocal({ kind: "permission", value }),
  });

  if (request.status !== "pending") {
    return <ResolvedPermission request={request} />;
  }

  const offerAlways = request.allowAlways && request.kind !== "publish";
  const requester = request.agentId ? agentLabels[request.agentId] : null;
  const pending = decide.isPending ? decide.variables : null;

  return (
    <Card aria-label={titleOf(request)} tone="warning">
      <CardHeader>
        <ShieldIcon
          aria-hidden="true"
          className="size-4 shrink-0 text-warning"
        />
        <CardTitle>{titleOf(request)}</CardTitle>
      </CardHeader>
      <CardContent>
        {request.toolUses.map((use, index) => (
          <div
            className="flex flex-col gap-sm"
            key={use.toolUseId ?? `${use.toolName}-${index}`}
          >
            <CodeBlock
              code={
                use.toolName === "Execute" ? `$ ${use.summary}` : use.summary
              }
              title={use.toolName}
            />
            {use.diff ? (
              <CodeBlock code={use.diff} title="Proposed change" />
            ) : null}
          </div>
        ))}
        {request.reason || requester ? (
          <p className="type-caption text-text-secondary">
            {request.reason}
            {request.reason && requester ? " " : ""}
            {requester ? `Requested by ${requester}.` : ""}
          </p>
        ) : null}
      </CardContent>
      <CardFooter>
        <Button
          disabled={decide.isPending}
          onClick={() => decide.mutate("approve_once")}
          variant="primary"
        >
          {pending === "approve_once" ? "Allowing…" : "Allow once"}
        </Button>
        {offerAlways ? (
          <Button
            disabled={decide.isPending}
            onClick={() => decide.mutate("always_allow")}
            variant="secondary"
          >
            Always allow
          </Button>
        ) : null}
        <Button
          disabled={decide.isPending}
          onClick={() => decide.mutate("deny")}
          variant="ghost"
        >
          {pending === "deny" ? "Denying…" : "Deny"}
        </Button>
      </CardFooter>
    </Card>
  );
};
