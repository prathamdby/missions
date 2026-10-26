import { describe, expect, it, vi } from "vitest";

import { deferred, transcriptItem } from "../live/test-adapters";
import {
  GeneratedUiSubmissions,
  latestOrchestratorReply,
} from "./generated-ui";
import type { MessageDelivery } from "./message-draft";
import type { TimelineEntry, TurnPart } from "./timeline";

const parts = (entries: TimelineEntry[]): TurnPart[] => [
  { entries, id: "turn", kind: "entries" },
];
const reply = (id: string, agentId = "a-1"): TimelineEntry => ({
  agentId,
  id,
  item: transcriptItem(1, "Reply"),
  kind: "assistant",
});
const agents = {
  "a-1": { role: "orchestrator" },
  "worker-1": { role: "worker" },
} as const;

describe(latestOrchestratorReply, () => {
  it("ignores thinking previews but admits a final reply or text preview", () => {
    const thinking: TimelineEntry = {
      agentId: "a-1",
      id: "thinking",
      kind: "preview",
      previewKind: "thinking",
      text: "Thinking",
    };
    expect(
      latestOrchestratorReply(parts([reply("final"), thinking]), agents)
    ).toBe("final");
    expect(latestOrchestratorReply(parts([thinking]), agents)).toBeUndefined();
    expect(
      latestOrchestratorReply(
        parts([{ ...thinking, id: "arriving", previewKind: "text" }]),
        agents
      )
    ).toBe("arriving");
  });

  it("ignores absent agent metadata and Worker replies", () => {
    expect(
      latestOrchestratorReply(
        parts([reply("final"), reply("unknown", "missing")]),
        agents
      )
    ).toBe("final");
    expect(
      latestOrchestratorReply(parts([reply("unknown")]), {})
    ).toBeUndefined();
    expect(
      latestOrchestratorReply(parts([reply("worker", "worker-1")]), agents)
    ).toBeUndefined();
  });

  it("returns nothing for an empty transcript or empty parts", () => {
    expect(latestOrchestratorReply([], agents)).toBeUndefined();
    expect(latestOrchestratorReply(parts([]), agents)).toBeUndefined();
  });
});

describe(GeneratedUiSubmissions, () => {
  it("captures text, delivery mode, and occurrence for uncertain retries", async () => {
    const submissions = new GeneratedUiSubmissions();
    const send = vi
      .fn<(delivery: MessageDelivery) => Promise<boolean>>()
      .mockRejectedValueOnce(new Error("Lost response"))
      .mockResolvedValueOnce(true);
    await submissions.send(
      "reply:block",
      { mode: "steer", text: "Original" },
      send
    );
    expect(submissions.snapshot("reply:block").status).toBe("failed");
    await submissions.send(
      "reply:block",
      { mode: "queue", text: "Changed" },
      send
    );
    expect(send.mock.calls[1]).toStrictEqual(send.mock.calls[0]);
    expect(send.mock.calls[1]?.[0].input).toStrictEqual({
      mode: "steer",
      text: "Original",
    });
    expect(submissions.snapshot("reply:block").status).toBe("sent");
  });

  it("admits one send while pending and none after success", async () => {
    const submissions = new GeneratedUiSubmissions();
    const pending = deferred<boolean>();
    const send = vi.fn<(delivery: MessageDelivery) => Promise<boolean>>(
      () => pending.promise
    );
    const input = { mode: "steer", text: "Continue" } as const;
    const first = submissions.send("reply:block", input, send);
    await submissions.send("reply:block", input, send);
    expect(submissions.snapshot("reply:block").status).toBe("sending");
    pending.resolve(true);
    await first;
    await submissions.send("reply:block", input, send);
    expect(send).toHaveBeenCalledOnce();
    expect(submissions.snapshot("reply:block").status).toBe("sent");
  });
});
