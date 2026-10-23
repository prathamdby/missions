"use client";

import type { Agent } from "@missions/protocol/missions";

import { ChatColumn } from "@/components/mission/chat-column";
import { CheckIcon, CloseIcon, PauseIcon } from "@/components/mission/icons";
import { useMission } from "@/components/mission/mission-context";
import { DotLoader } from "@/components/mission/panel-kit";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const AgentState = ({ agent }: { agent: Agent }) => {
  const { live } = useMission();
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
  const { agentLabels, live, selectedAgentId, showAgent } = useMission();
  const agents = Object.values(live.agents).toSorted(
    (a, b) =>
      Number(b.role === "orchestrator") - Number(a.role === "orchestrator") ||
      a.createdAt.localeCompare(b.createdAt)
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
      <div className="flex h-13 shrink-0 items-center overflow-x-auto border-b border-border-subtle px-lg">
        <TabsList aria-label="Agent conversations" variant="conversation">
          {agents.map((agent) => (
            <TabsTrigger variant="conversation" key={agent.id} value={agent.id}>
              {agent.role === "orchestrator"
                ? "Orchestrator"
                : (live.assignments[agent.assignmentId ?? ""]?.title ??
                  agentLabels[agent.id] ??
                  agent.title)}
              <AgentState agent={agent} />
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <TabsContent className="flex min-h-0 flex-col" value={selected.id}>
        <ChatColumn agentId={selected.id} key={selected.id} />
      </TabsContent>
    </Tabs>
  );
};
