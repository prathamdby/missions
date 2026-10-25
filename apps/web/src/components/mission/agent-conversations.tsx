"use client";

import type { Agent } from "@missions/protocol/missions";

import { ChatColumn } from "@/components/mission/chat-column";
import { CheckIcon, CloseIcon, PauseIcon } from "@/components/mission/icons";
import { useMission } from "@/components/mission/mission-context";
import { DotLoader } from "@/components/mission/panel-kit";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ConversationTab,
  Tabs,
  TabsContent,
  TabsList,
} from "@/components/ui/tabs";
import { orderedAgents } from "@/lib/mission/conversation-tabs";
import { WAITING, waitingOf } from "@/lib/mission/waiting";

/** Waiting for the agent's own progress, not for the user. */
const SELF_WAITS = new Set([
  "startup",
  "model",
  "write_lease",
  "retry",
  "reconnecting",
]);

const AgentState = ({ agent }: { agent: Agent }) => {
  const { live } = useMission();
  const waiting = waitingOf(agent);
  if (waiting && SELF_WAITS.has(waiting)) {
    return (
      <span className="flex items-center gap-tight text-2xs leading-xs text-text-tertiary">
        <DotLoader label={WAITING[waiting].long} tone="accent" />
        {WAITING[waiting].short}
      </span>
    );
  }
  if (agent.status === "working" || agent.status === "starting") {
    return <DotLoader label="Working" tone="accent" />;
  }
  if (
    agent.status === "waiting_answer" ||
    agent.status === "waiting_permission" ||
    (agent.role === "orchestrator" &&
      live.mission.status === "awaiting_approval")
  ) {
    return <span className="text-2xs leading-xs text-warning">Needs you</span>;
  }
  if (agent.status === "failed") {
    return <CloseIcon className="text-danger" />;
  }
  if (agent.status === "stopped") {
    return live.assignments[agent.assignmentId ?? ""]?.status ===
      "handed_off" ? (
      <CheckIcon className="text-text-tertiary" />
    ) : (
      <PauseIcon className="text-text-tertiary" />
    );
  }
  return null;
};

/** Paper's horizontal, independently selectable agent conversations. */
export const AgentConversations = () => {
  const {
    agentLabels,
    closeAgent,
    closedAgentIds,
    live,
    selectedAgentId,
    showAgent,
  } = useMission();
  const agents = orderedAgents(Object.values(live.agents)).filter(
    (agent) => !closedAgentIds.includes(agent.id)
  );
  const selected =
    agents.find((agent) => agent.id === selectedAgentId) ?? agents[0];
  if (!selected) {
    return <ChatColumn />;
  }
  return (
    <Tabs
      className="flex min-h-0 flex-1 flex-col"
      onValueChange={showAgent}
      value={selected.id}
    >
      <ScrollArea asChild axis="x">
        <div className="flex h-13 shrink-0 items-center border-b border-border-subtle px-lg">
          <TabsList aria-label="Agent conversations" variant="conversation">
            {agents.map((agent) => {
              const label =
                agent.role === "orchestrator"
                  ? "Orchestrator"
                  : (live.assignments[agent.assignmentId ?? ""]?.title ??
                    agentLabels[agent.id] ??
                    agent.title);
              return (
                <ConversationTab
                  key={agent.id}
                  label={label}
                  onClose={
                    agent.role === "orchestrator"
                      ? undefined
                      : () => closeAgent(agent.id)
                  }
                  selected={selected.id === agent.id}
                  value={agent.id}
                >
                  {label}
                  <AgentState agent={agent} />
                </ConversationTab>
              );
            })}
          </TabsList>
        </div>
      </ScrollArea>
      <TabsContent className="flex min-h-0 flex-col" value={selected.id}>
        <ChatColumn agentId={selected.id} key={selected.id} />
      </TabsContent>
    </Tabs>
  );
};
