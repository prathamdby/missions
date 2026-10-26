import type { Agent } from "@missions/protocol/missions";

import type { TurnPart } from "./timeline";

export const latestOrchestratorReply = (
  parts: readonly TurnPart[],
  agents: Readonly<Record<string, Pick<Agent, "role">>>
) =>
  parts
    .flatMap((part) => part.entries)
    .findLast(
      (entry) =>
        entry.agentId !== null &&
        agents[entry.agentId]?.role === "orchestrator" &&
        (entry.kind === "assistant" ||
          (entry.kind === "preview" && entry.previewKind === "text"))
    )?.id;
