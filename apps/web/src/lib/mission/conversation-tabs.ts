import type { Agent } from "@missions/protocol/missions";

export interface ConversationTabs {
  closed: readonly string[];
  selected: string | null;
}

type TabAgent = Pick<Agent, "id" | "createdAt" | "role">;

export const orderedAgents = <T extends TabAgent>(agents: readonly T[]) =>
  agents.toSorted(
    (a, b) =>
      Number(b.role === "orchestrator") - Number(a.role === "orchestrator") ||
      a.createdAt.localeCompare(b.createdAt)
  );

export const conversationTabs = (
  state: ConversationTabs,
  action:
    | { kind: "show"; id: string }
    | { kind: "close"; id: string; agents: readonly TabAgent[] }
): ConversationTabs => {
  if (action.kind === "show") {
    return {
      closed: state.closed.filter((id) => id !== action.id),
      selected: action.id,
    };
  }
  const visible = orderedAgents(action.agents).filter(
    (agent) => !state.closed.includes(agent.id)
  );
  const index = visible.findIndex((agent) => agent.id === action.id);
  if (index === -1 || visible[index]?.role === "orchestrator") {
    return state;
  }
  const selected = state.selected ?? visible[0]?.id;
  return {
    closed: [...state.closed, action.id],
    selected:
      selected === action.id
        ? ((visible[index + 1] ?? visible[index - 1])?.id ?? null)
        : state.selected,
  };
};
