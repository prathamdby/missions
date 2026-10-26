// @vitest-environment jsdom

import { SubmitMessageRequestSchema } from "@missions/protocol/commands";
import { AgentSchema } from "@missions/protocol/missions";
import type { QueueItem, TranscriptItem } from "@missions/protocol/missions";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api/endpoints";
import { OperationIntents } from "@/lib/api/operation-intents";
import { fromSnapshot } from "@/lib/live/mission-state";
import {
  AT,
  deferred,
  plan,
  queueItem,
  snapshot,
  transcriptItem,
} from "@/lib/live/test-adapters";
import { missionCommandTransport } from "@/lib/mission/command-transport";
import { MissionCommands } from "@/lib/mission/commands";
import type { TurnPart } from "@/lib/mission/timeline";

import { MissionProvider } from "./mission-context";
import type { MissionContextValue } from "./mission-context";
import { PlanCard } from "./plan-card";
import { Transcript } from "./transcript";

const button = (label: string) =>
  `\`\`\`openui-lang\nroot = Stack([Button("continue_conversation", "${label}", "Continue with the chosen approach")])\n\`\`\``;

const partsFor = (items: TranscriptItem[]): TurnPart[] => [
  {
    entries: items.map((item) => ({
      agentId: item.agentId,
      id: item.id,
      item,
      kind: "assistant",
    })),
    id: "entries",
    kind: "entries",
  },
];

describe("generated UI message admission", () => {
  let host: HTMLDivElement;
  let root: Root;
  let client: QueryClient;
  let context: MissionContextValue;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["models"], { models: [] });
    const main = AgentSchema.parse({
      assignmentId: null,
      createdAt: AT,
      holdsWriteLease: false,
      id: "a-1",
      missionId: "m-1",
      model: { modelId: "test", reasoningEffort: null },
      role: "orchestrator",
      sessionId: null,
      status: "idle",
      title: "Orchestrator",
      updatedAt: AT,
      workingState: null,
    });
    const refresh = vi.fn<MissionContextValue["refresh"]>(() =>
      Promise.resolve(true)
    );
    context = {
      agentLabels: {},
      applyLocal: vi.fn<MissionContextValue["applyLocal"]>(),
      closeAgent: vi.fn<MissionContextValue["closeAgent"]>(),
      closedAgentIds: [],
      commands: new MissionCommands(
        "m-1",
        missionCommandTransport(
          "m-1",
          vi.fn<MissionContextValue["applyLocal"]>(),
          refresh
        ),
        new OperationIntents(() => "operation-ui-1")
      ),
      failIdleSubmission: vi.fn<MissionContextValue["failIdleSubmission"]>(),
      idleSubmissions: {},
      live: fromSnapshot(
        snapshot({
          agents: [main, { ...main, id: "worker-1", role: "worker" }],
          transcript: [],
        })
      ),
      loadOlder: vi.fn<MissionContextValue["loadOlder"]>(() =>
        Promise.resolve(false)
      ),
      missionId: "m-1",
      presentIdleSubmission:
        vi.fn<MissionContextValue["presentIdleSubmission"]>(),
      refresh,
      selectedAgentId: null,
      sessionError: null,
      showAgent: vi.fn<MissionContextValue["showAgent"]>(),
      showPanel: vi.fn<MissionContextValue["showPanel"]>(),
    };
  });

  afterEach(async () => {
    await act(() => root.unmount());
    client.clear();
    host.remove();
    vi.restoreAllMocks();
  });

  const render = async (children: ReactNode) => {
    await act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <MissionProvider value={context}>{children}</MissionProvider>
        </QueryClientProvider>
      )
    );
  };

  const renderTranscript = async (items: TranscriptItem[]) => {
    await render(
      <Transcript now={0} parts={partsFor(items)} running={false} />
    );
  };

  it("enables only the latest Orchestrator reply, not older replies or Workers", async () => {
    await renderTranscript([
      transcriptItem(1, button("Older")),
      transcriptItem(2, button("Latest")),
      { ...transcriptItem(3, button("Worker")), agentId: "worker-1" },
    ]);
    const controls = [...host.querySelectorAll("button")];
    expect(
      controls.map((control) => [control.textContent, control.disabled])
    ).toStrictEqual([
      ["Older", true],
      ["Latest", false],
      ["Worker", true],
    ]);
    await renderTranscript([
      { ...transcriptItem(3, button("Worker")), agentId: "worker-1" },
    ]);
    expect(host.querySelector("button")?.disabled).toBeTruthy();
  });

  it("keeps the plan card read-only", async () => {
    await render(
      <PlanCard
        latest
        plan={{
          ...plan("approved"),
          markdown: `${button("Plan action")}\n\n1. Implement the approach`,
        }}
      />
    );
    expect(
      host
        .querySelector('[data-slot="generated-ui"] button')
        ?.hasAttribute("disabled")
    ).toBeTruthy();
  });

  it("keeps closed fences disabled until the text preview finishes", async () => {
    const parts = partsFor([transcriptItem(1, button("Earlier"))]).map(
      (part) => ({
        ...part,
        entries: [
          ...part.entries,
          {
            agentId: "a-1",
            id: "preview",
            kind: "preview" as const,
            previewKind: "text" as const,
            text: button("Arriving"),
          },
        ],
      })
    );
    await render(<Transcript now={0} parts={parts} running />);
    expect(
      [...host.querySelectorAll("button")].map((control) => [
        control.textContent,
        control.disabled,
      ])
    ).toStrictEqual([
      ["Earlier", true],
      ["Arriving", true],
    ]);
    await renderTranscript([
      transcriptItem(1, button("Earlier")),
      transcriptItem(2, button("Arriving")),
    ]);
    expect(
      [...host.querySelectorAll("button")].map((control) => [
        control.textContent,
        control.disabled,
      ])
    ).toStrictEqual([
      ["Earlier", true],
      ["Arriving", false],
    ]);
  });

  it("disables the latest reply when messaging is unavailable", async () => {
    context.live.mission.status = "paused";
    await renderTranscript([transcriptItem(1, button("Continue"))]);
    expect(host.querySelector("button")?.disabled).toBeTruthy();
    expect(host.querySelector("button")?.title).toContain("stopped");
  });

  it.each(["idle", "working"] as const)(
    "sends the exact request once when the Orchestrator is %s",
    async (status) => {
      const main = context.live.agents["a-1"];
      if (!main) {
        throw new Error("Missing Orchestrator");
      }
      main.status = status;
      const pending = deferred<QueueItem>();
      const submit = vi
        .spyOn(api, "submitMessage")
        .mockReturnValue(pending.promise);
      await renderTranscript([transcriptItem(1, button("Continue"))]);
      const control = host.querySelector("button");
      if (!control) {
        throw new Error("Missing control");
      }
      await act(() => {
        control.click();
        control.click();
      });
      const expected = {
        mode: status === "working" ? "queue" : "steer",
        operationId: "operation-ui-1",
        text: "Continue with the chosen approach",
      };
      expect(submit).toHaveBeenCalledExactlyOnceWith("m-1", expected);
      expect(SubmitMessageRequestSchema.parse(expected)).toStrictEqual(
        expected
      );
      expect(control.disabled).toBeTruthy();
      expect(vi.mocked(context.presentIdleSubmission).mock.calls).toStrictEqual(
        status === "idle"
          ? [
              [
                {
                  attachments: [],
                  failed: false,
                  id: "operation-ui-1",
                  text: expected.text,
                },
              ],
            ]
          : []
      );
      await act(async () => {
        pending.resolve(queueItem(1, "sent"));
        await pending.promise;
      });
      expect(control.disabled).toBeTruthy();
    }
  );

  it("keeps an uncertain action's operation ID for an explicit retry", async () => {
    const submit = vi
      .spyOn(api, "submitMessage")
      .mockRejectedValueOnce(new Error("Lost response"))
      .mockResolvedValueOnce(queueItem(1, "sent"));
    await renderTranscript([transcriptItem(1, button("Retry"))]);
    const control = host.querySelector("button");
    if (!control) {
      throw new Error("Missing control");
    }
    await act(() => {
      control.click();
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Message not sent"
    );
    expect(control.disabled).toBeFalsy();
    expect(context.failIdleSubmission).toHaveBeenCalledWith("operation-ui-1");
    await act(() => {
      control.click();
    });
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1]).toStrictEqual(submit.mock.calls[0]);
  });
});
