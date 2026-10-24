"use client";

import type { PermissionRequest } from "@missions/protocol/missions";

import { ChatCard } from "@/components/mission/chat-cards";
import { CheckIcon, CloseIcon, ShieldIcon } from "@/components/mission/icons";
import { useMission } from "@/components/mission/mission-context";
import { usePermissionDecision } from "@/components/mission/use-permission-decision";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { permissionDecisions } from "@/lib/mission/permissions";

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

const WHITESPACE = /\s+/u;

const summaryOf = (request: PermissionRequest) =>
  request.toolUses.map((use) => use.summary).join(", ") || "this action";

/** "Always allow git push": the command's first two words, or the tool name. */
const alwaysLabel = (request: PermissionRequest) => {
  const [first] = request.toolUses;
  if (request.toolUses.length !== 1 || !first) {
    return "Always allow";
  }
  if (first.toolName !== "Execute") {
    return `Always allow ${first.toolName}`;
  }
  const words = first.summary.trim().split(WHITESPACE).slice(0, 2).join(" ");
  return words ? `Always allow ${words}` : "Always allow";
};

const ResolvedPermission = ({ request }: { request: PermissionRequest }) => {
  let text = "Request expired before a decision";
  let icon = <CloseIcon className="size-3.5" />;
  if (request.status === "approved") {
    text =
      request.decision === "always_allow"
        ? "You always allowed"
        : "You allowed";
    icon = <CheckIcon className="size-3.5" />;
  } else if (request.status === "denied") {
    text = "You denied";
  }
  return (
    <p className="flex min-w-0 items-center gap-sm text-xs leading-sm font-book tracking-tight text-text-tertiary">
      {icon}
      <span className="shrink-0">{text}</span>
      <span className="truncate font-mono text-2xs leading-xs">
        {summaryOf(request)}
      </span>
    </p>
  );
};

const ToolUse = ({ use }: { use: PermissionRequest["toolUses"][number] }) => (
  <div className="flex flex-col gap-sm">
    <ScrollArea asChild axis="x">
      <div className="flex items-start gap-md rounded-sm bg-surface px-lg py-control font-mono text-xs leading-sm font-book">
        <span className="shrink-0 text-text-tertiary">
          {use.toolName === "Execute" ? "$" : use.toolName}
        </span>
        <span className="whitespace-pre-wrap text-text select-text">
          {use.summary}
        </span>
      </div>
    </ScrollArea>
    {use.diff ? (
      <ScrollArea asChild axis="both">
        <pre className="max-h-60 rounded-sm bg-surface px-lg py-control font-mono text-xs leading-md text-text-secondary select-text">
          {use.diff}
        </pre>
      </ScrollArea>
    ) : null}
  </div>
);

/** Paper SPM: pending tool or publish gate with Allow once / Always allow / Deny. */
export const PermissionCard = ({ request }: { request: PermissionRequest }) => {
  const { agentLabels } = useMission();
  const decide = usePermissionDecision(request);

  if (request.status !== "pending") {
    return <ResolvedPermission request={request} />;
  }

  const offerAlways = permissionDecisions(request).includes("always_allow");
  const requester = request.agentId ? agentLabels[request.agentId] : null;
  const pending = decide.isPending ? decide.variables : null;
  const detail = [request.reason, requester ? `Requested by ${requester}.` : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <ChatCard label={titleOf(request)} testId="permission-card" tone="warning">
      <div className="flex flex-col gap-lg p-card">
        <div className="flex items-center gap-control">
          <ShieldIcon className="text-warning" />
          <h3 className="min-w-0 flex-1 text-sm leading-sm font-medium tracking-tight text-text">
            {titleOf(request)}
          </h3>
        </div>
        {request.toolUses.map((use, index) => (
          <ToolUse
            key={use.toolUseId ?? `${use.toolName}-${index}`}
            use={use}
          />
        ))}
        {detail ? (
          <p className="text-sm leading-chat font-book tracking-tight text-text-secondary">
            {detail}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-md">
          <Button
            data-testid="permission-allow-once"
            disabled={decide.isPending}
            onClick={() => decide.mutate("approve_once")}
            variant="primary"
          >
            {pending === "approve_once" ? "Allowing…" : "Allow once"}
          </Button>
          {offerAlways ? (
            <Button
              data-testid="permission-always"
              disabled={decide.isPending}
              onClick={() => decide.mutate("always_allow")}
              variant="secondary"
            >
              {alwaysLabel(request)}
            </Button>
          ) : null}
          <Button
            data-testid="permission-deny"
            disabled={decide.isPending}
            onClick={() => decide.mutate("deny")}
            variant="ghost"
          >
            {pending === "deny" ? "Denying…" : "Deny"}
          </Button>
        </div>
      </div>
    </ChatCard>
  );
};
