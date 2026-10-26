import type { Agent } from "@missions/protocol/missions";

import type { MessageDelivery } from "./message-draft";
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

export interface GeneratedUiSubmission {
  delivery: MessageDelivery | null;
  status: "ready" | "sending" | "sent" | "failed";
}

export const EMPTY_GENERATED_UI_SUBMISSION: GeneratedUiSubmission = {
  delivery: null,
  status: "ready",
};

/** Mission-owned action admission survives transcript and agent-tab remounts. */
export class GeneratedUiSubmissions {
  private readonly submissions = new Map<string, GeneratedUiSubmission>();
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  snapshot = (key: string): GeneratedUiSubmission =>
    this.submissions.get(key) ?? EMPTY_GENERATED_UI_SUBMISSION;

  async send(
    key: string,
    input: MessageDelivery["input"],
    send: (delivery: MessageDelivery) => Promise<boolean>
  ): Promise<void> {
    const current = this.snapshot(key);
    if (current.status === "sending" || current.status === "sent") {
      return;
    }
    const delivery = current.delivery ?? {
      input: structuredClone(input),
      occurrence: crypto.randomUUID(),
    };
    this.update(key, { delivery, status: "sending" });
    try {
      const sent = await send(delivery);
      this.update(key, { delivery, status: sent ? "sent" : "failed" });
    } catch {
      this.update(key, { delivery, status: "failed" });
    }
  }

  private update(key: string, submission: GeneratedUiSubmission): void {
    this.submissions.set(key, submission);
    for (const listener of this.listeners) {
      listener();
    }
  }
}
