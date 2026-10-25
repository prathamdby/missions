import { describe, expect, it } from "vitest";

import { conversationTabs } from "./conversation-tabs";

const agents = [
  { createdAt: "2026-01-01", id: "orch", role: "orchestrator" as const },
  { createdAt: "2026-01-02", id: "one", role: "worker" as const },
  { createdAt: "2026-01-03", id: "two", role: "worker" as const },
];

describe(conversationTabs, () => {
  it("closes a selected worker onto its neighbor without changing agents", () => {
    expect(
      conversationTabs(
        { closed: [], selected: "one" },
        { agents, id: "one", kind: "close" }
      )
    ).toStrictEqual({ closed: ["one"], selected: "two" });
    expect(
      conversationTabs(
        { closed: [], selected: "two" },
        { agents, id: "two", kind: "close" }
      )
    ).toStrictEqual({ closed: ["two"], selected: "one" });
    expect(agents).toHaveLength(3);
  });

  it("keeps selection when another tab closes and protects Orchestrator", () => {
    const state = { closed: [], selected: "two" };
    expect(
      conversationTabs(state, { agents, id: "one", kind: "close" }).selected
    ).toBe("two");
    expect(conversationTabs(state, { agents, id: "orch", kind: "close" })).toBe(
      state
    );
  });

  it("ignores a repeated close and selects Orchestrator when the last worker closes", () => {
    const state = { closed: ["one"], selected: "two" };
    expect(conversationTabs(state, { agents, id: "one", kind: "close" })).toBe(
      state
    );
    expect(
      conversationTabs(state, { agents, id: "two", kind: "close" })
    ).toStrictEqual({ closed: ["one", "two"], selected: "orch" });
  });

  it("reopens and selects a closed tab from any entry point", () => {
    expect(
      conversationTabs(
        { closed: ["one", "two"], selected: "orch" },
        { id: "one", kind: "show" }
      )
    ).toStrictEqual({ closed: ["two"], selected: "one" });
  });
});
