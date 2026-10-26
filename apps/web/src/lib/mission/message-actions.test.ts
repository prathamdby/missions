import type { TranscriptItem } from "@missions/protocol/missions";
import { describe, expect, it } from "vitest";

import { forkGoal, messageLink } from "./message-actions";

const item = (
  id: string,
  kind: TranscriptItem["kind"],
  text: string,
  seq: number
): TranscriptItem => ({
  agentId: "a-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  id,
  isError: false,
  kind,
  missionId: "m-1",
  purpose: null,
  recipient: null,
  requestId: null,
  sender:
    kind === "agent_message"
      ? { agentId: "a-1", role: "orchestrator", title: "Orchestrator" }
      : null,
  seq,
  text,
  toolName: null,
  toolUseId: null,
});

describe("message actions", () => {
  it("builds a fork goal through the chosen message and no further", () => {
    const items = [
      item("u1", "user", "Find the bug", 1),
      item("a1", "assistant", "Looking", 2),
      item("m1", "agent_message", "It is in the parser", 3),
      item("u2", "user", "Also rename it", 4),
    ];
    const goal = forkGoal(items, "m1");
    expect(goal).toContain("Find the bug");
    expect(goal).toContain("It is in the parser");
    expect(goal).not.toContain("Looking");
    expect(goal).not.toContain("Also rename it");
    expect(forkGoal(items, "missing")).toBeNull();
  });

  it("orders by sequence and clips a long message", () => {
    const items = [
      item("u2", "user", "Second", 4),
      item("u1", "user", "x".repeat(600), 1),
    ];
    const goal = forkGoal(items, "u2");
    const [first, second] =
      goal?.split("\n").filter((line) => line.startsWith("- ")) ?? [];
    expect(first).toBe(`- User: ${"x".repeat(500)}…`);
    expect(second).toBe("- User: Second");
  });

  it("copies a link whose hash is the message anchor", () => {
    expect(messageLink("http://localhost:4318", "m-1", "t-4")).toBe(
      "http://localhost:4318/missions/m-1#m-t-4"
    );
  });
});
