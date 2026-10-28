// @vitest-environment jsdom

import type { TranscriptItem } from "@missions/protocol/missions";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { fromSnapshot } from "@/lib/live/mission-state";
import { snapshot } from "@/lib/live/test-adapters";
import { MessageDraft } from "@/lib/mission/message-draft";
import type { TurnPart } from "@/lib/mission/timeline";

import { MissionProvider } from "./mission-context";
import type { MissionContextValue } from "./mission-context";
import { Transcript } from "./transcript";

const item = (
  id: string,
  kind: TranscriptItem["kind"],
  text: string
): TranscriptItem => ({
  agentId: "a-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  id,
  isError: false,
  kind,
  missionId: "m-1",
  purpose: null,
  recipient:
    kind === "agent_message"
      ? { agentId: "worker-1", role: "worker", title: "Worker" }
      : null,
  requestId: null,
  sender:
    kind === "agent_message"
      ? { agentId: "a-1", role: "orchestrator", title: "Orchestrator" }
      : null,
  seq: 1,
  text,
  toolName: null,
  toolUseId: null,
});

const part = (entries: TranscriptItem[]): TurnPart => ({
  entries: entries.map((entry) => ({
    agentId: entry.agentId,
    id: entry.id,
    item: entry,
    kind:
      entry.kind === "user" || entry.kind === "agent_message"
        ? entry.kind
        : "assistant",
  })),
  id: "entries",
  kind: "entries",
});

describe("message footer", () => {
  let host: HTMLDivElement;
  let root: Root;
  const rewindFrom = vi.fn<(item: TranscriptItem) => void>();
  const forkFrom = vi.fn<(item: TranscriptItem) => void>();
  const draft = new MessageDraft();

  const value = {
    agentLabels: {},
    draft,
    forkFrom,
    live: fromSnapshot(snapshot({ transcript: [] })),
    missionId: "m-1",
    rewindFrom,
  } as unknown as MissionContextValue;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {
          return this;
        }
        unobserve() {
          return this;
        }
        disconnect() {
          return this;
        }
      }
    );
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    rewindFrom.mockReset();
    forkFrom.mockReset();
  });

  afterEach(async () => {
    await act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  const render = async (entries: TranscriptItem[]) => {
    await act(() =>
      root.render(
        <TooltipProvider>
          <MissionProvider value={value}>
            <Transcript now={0} parts={[part(entries)]} running={false} />
          </MissionProvider>
        </TooltipProvider>
      )
    );
  };

  const labels = () =>
    [...host.querySelectorAll("button")].map(
      (button) => button.getAttribute("aria-label") ?? ""
    );

  it("offers edit, copy and link on a user message only", async () => {
    await render([
      item("a-1:native:text", "user", "Find the bug"),
      item("reply", "assistant", "Looking"),
    ]);
    expect(labels()).toStrictEqual([
      "Edit from here",
      "Copy message",
      "Copy link",
    ]);
    expect(host.querySelector("#m-a-1\\:native\\:text")).not.toBeNull();
    expect(host.querySelector("#m-reply")).toBeNull();
  });

  it("offers copy and fork on an agent message", async () => {
    await render([item("queue:message", "agent_message", "Handing off")]);
    expect(labels()).toStrictEqual(["Copy message", "Fork from here"]);
  });

  it("copies the message text and reports a clipboard failure", async () => {
    const writeText = vi.fn<(value: string) => Promise<void>>(() =>
      Promise.reject(new Error("denied"))
    );
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await render([item("a-1:native:text", "user", "Find the bug")]);
    const copy = [...host.querySelectorAll("button")].find(
      (button) => button.getAttribute("aria-label") === "Copy message"
    );
    await act(() => {
      copy?.click();
    });
    expect(writeText).toHaveBeenCalledWith("Find the bug");
  });

  it("puts the user message back in the composer without sending it", async () => {
    await render([item("a-1:native:text", "user", "Find the bug")]);
    const edit = [...host.querySelectorAll("button")].find(
      (button) => button.getAttribute("aria-label") === "Edit from here"
    );
    await act(() => {
      edit?.click();
    });
    expect(rewindFrom).toHaveBeenCalledOnce();
    expect(forkFrom).not.toHaveBeenCalled();
  });
});
