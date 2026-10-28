// @vitest-environment jsdom

import type { QueueItem } from "@missions/protocol/missions";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { OperationIntents } from "@/lib/api/operation-intents";
import { fromSnapshot } from "@/lib/live/mission-state";
import { queueItem, snapshot } from "@/lib/live/test-adapters";
import { missionCommandTransport } from "@/lib/mission/command-transport";
import { MissionCommands } from "@/lib/mission/commands";
import { MessageDraft } from "@/lib/mission/message-draft";
import { dismissToast, getToasts } from "@/lib/toast-store";

import { MissionComposer } from "./composer";
import { MissionProvider } from "./mission-context";
import type { MissionContextValue } from "./mission-context";

type FetchStub = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

const CATALOG = JSON.stringify({ commands: [], source: "unavailable" });

/** Daemon answers for the edit endpoints and composer catalog. */
const respond =
  (outcome: "already_sent" | "replaced") => (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("composer-catalog")) {
      return Promise.resolve(new Response(CATALOG, { status: 200 }));
    }
    if (url.endsWith("/edit")) {
      return Promise.resolve(
        Response.json({
          outcome,
          replacementId: outcome === "replaced" ? "queue-2" : null,
        })
      );
    }
    if (url.endsWith("/rewind")) {
      return Promise.resolve(Response.json(snapshot().mission));
    }
    return Promise.resolve(Response.json({}));
  };

const composer = (host: HTMLElement) =>
  host.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]');

const editedRow = (host: HTMLElement) =>
  host.querySelector<HTMLLIElement>('[aria-label="Message queue"] li');

const buttonNamed = (host: HTMLElement, name: string) =>
  [...host.querySelectorAll("button")].find(
    (button) => button.getAttribute("aria-label") === name
  );

const cancelButton = (host: HTMLElement) =>
  [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "Cancel"
  );

const type = (field: HTMLTextAreaElement, value: string) => {
  // React tracks the previous value, so type through the native setter.
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value"
  )?.set;
  setter?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
};

const liveFor = (texts: readonly string[], state: QueueItem["state"]) =>
  fromSnapshot(
    snapshot({
      queue: texts.map((text, index) => ({
        ...queueItem(index + 1, state),
        id: `queue-${index + 1}`,
        sequence: index,
        text,
      })),
    })
  );

/** Waits for the requestAnimationFrame the composer defers settlement to. */
const nextFrame = () => {
  const frame = Promise.withResolvers<undefined>();
  requestAnimationFrame(() => frame.resolve(undefined));
  return frame.promise;
};

describe("message edit", () => {
  let host: HTMLDivElement;
  let root: Root;
  let client: QueryClient;
  let missionDraft: MessageDraft;
  let fetch_: Mock<FetchStub>;
  let refresh: Mock<MissionContextValue["refresh"]>;
  let props: MissionContextValue;
  let composerMounted: boolean;

  const paint = async () => {
    const value = props;
    await act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <TooltipProvider>
            <MissionProvider value={value}>
              {composerMounted ? <MissionComposer onSend={() => null} /> : null}
            </MissionProvider>
          </TooltipProvider>
        </QueryClientProvider>
      )
    );
  };

  const render = async (
    texts: readonly string[] = ["Fix it"],
    state: QueueItem["state"] = "accepted"
  ) => {
    const applyLocal = vi.fn<MissionContextValue["applyLocal"]>();
    const value = {
      agentLabels: {},
      applyLocal,
      cancelTranscriptEdit:
        vi.fn<MissionContextValue["cancelTranscriptEdit"]>(),
      closeAgent: vi.fn<MissionContextValue["closeAgent"]>(),
      closedAgentIds: [],
      commands: new MissionCommands(
        "m-1",
        missionCommandTransport("m-1", applyLocal, refresh),
        new OperationIntents(() => "operation-edit")
      ),
      draft: missionDraft,
      failIdleSubmission: vi.fn<MissionContextValue["failIdleSubmission"]>(),
      forkFrom: vi.fn<MissionContextValue["forkFrom"]>(),
      idleSubmissions: {},
      live: liveFor(texts, state),
      loadOlder: vi.fn<MissionContextValue["loadOlder"]>(),
      missionId: "m-1",
      presentIdleSubmission:
        vi.fn<MissionContextValue["presentIdleSubmission"]>(),
      refresh,
      rewindFrom: vi.fn<MissionContextValue["rewindFrom"]>(),
      rewindSaving: false,
      selectedAgentId: null,
      sessionError: null,
      setRewindSaving: vi.fn<MissionContextValue["setRewindSaving"]>(),
      setTranscriptEditError:
        vi.fn<MissionContextValue["setTranscriptEditError"]>(),
      showAgent: vi.fn<MissionContextValue["showAgent"]>(),
      showPanel: vi.fn<MissionContextValue["showPanel"]>(),
      transcriptEdit: null,
    } as unknown as MissionContextValue;
    props = value;
    await paint();
  };

  /** Re-renders with a new live snapshot, as a daemon push would. */
  const repaint = async (
    texts: readonly string[],
    state: QueueItem["state"]
  ) => {
    props = { ...props, live: liveFor(texts, state) };
    await paint();
  };

  const beginEdit = async () => {
    const edit = buttonNamed(host, "Edit queued message");
    if (!edit) {
      throw new Error("Missing edit button");
    }
    await act(() => edit.click());
  };

  const beginRewind = async () => {
    const editDraft = new MessageDraft();
    editDraft.change("Sent message");
    props = {
      ...props,
      cancelTranscriptEdit: vi.fn<MissionContextValue["cancelTranscriptEdit"]>(
        () => {
          props = { ...props, transcriptEdit: null };
        }
      ),
      transcriptEdit: {
        draft: editDraft,
        error: null,
        itemId: "sent-message",
        originalText: "Sent message",
        requestId: "sent-request",
        seq: 1,
      },
    };
    await paint();
  };

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.stubGlobal(
      "ResizeObserver",
      vi.fn(() => ({
        disconnect: vi.fn<() => void>(),
        observe: vi.fn<() => void>(),
        unobserve: vi.fn<() => void>(),
      }))
    );
    vi.stubGlobal(
      "matchMedia",
      vi.fn<(query: string) => unknown>(() => ({
        addEventListener: vi.fn<() => void>(),
        dispatchEvent: vi.fn<() => void>(),
        matches: false,
        removeEventListener: vi.fn<() => void>(),
      }))
    );
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    client = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });
    for (const shown of getToasts()) {
      dismissToast(shown.id);
    }
    missionDraft = new MessageDraft();
    composerMounted = true;
    refresh = vi.fn<MissionContextValue["refresh"]>(() =>
      Promise.resolve(true)
    );
    fetch_ = vi.fn<FetchStub>(respond("replaced"));
    vi.stubGlobal("fetch", fetch_);
  });

  afterEach(async () => {
    await act(() => root.unmount());
    host.remove();
    client.clear();
    vi.unstubAllGlobals();
  });

  it("opens a sent message in the dock without changing the composer draft", async () => {
    missionDraft.change("Unsent draft");
    await render();
    await beginRewind();
    expect(composer(host)?.value).toBe("Sent message");
    expect(composer(host)?.getAttribute("aria-label")).toBe("Editing message");
    expect(buttonNamed(host, "Update message")).toBeDefined();
    expect(buttonNamed(host, "Stop editing")).toBeDefined();
    expect(missionDraft.snapshot()).toBe("Unsent draft");
  });

  it("posts one rewind with the revision, operation ID and trimmed edit", async () => {
    await render();
    await beginRewind();
    const field = composer(host);
    if (!field) {
      throw new Error("Missing composer");
    }
    await act(() => type(field, "  Revised sent message  "));
    await act(async () => {
      buttonNamed(host, "Update message")?.click();
      await Promise.resolve();
    });
    const requests = fetch_.mock.calls.filter(([input]) =>
      String(input).endsWith("/transcript/sent-message/rewind")
    );
    expect(requests).toHaveLength(1);
    expect(JSON.parse(String(requests[0]?.[1]?.body))).toStrictEqual({
      expectedRevision: 1,
      operationId: "operation-edit",
      text: "Revised sent message",
    });
    expect(
      fetch_.mock.calls.filter(([input]) => String(input).endsWith("/messages"))
    ).toHaveLength(0);
    expect(props.cancelTranscriptEdit).toHaveBeenCalledOnce();
    expect(missionDraft.snapshot()).toBe("");
  });

  it("returns a cancelled sent-message edit to the empty composer without sending", async () => {
    await render();
    await beginRewind();
    const field = composer(host);
    if (!field) {
      throw new Error("Missing composer");
    }
    await act(() => type(field, "Keep this edit"));
    await act(() => buttonNamed(host, "Stop editing")?.click());
    await paint();
    expect(missionDraft.snapshot()).toBe("Keep this edit");
    expect(composer(host)?.value).toBe("Keep this edit");
    expect(composer(host)?.getAttribute("aria-label")).toBe(
      "Message the Orchestrator"
    );
    expect(
      fetch_.mock.calls.filter(([input]) => String(input).endsWith("/rewind"))
    ).toHaveLength(0);
  });

  it("keeps an unsaved sent-message edit when agent tabs unmount the composer", async () => {
    await render();
    await beginRewind();
    const field = composer(host);
    if (!field) {
      throw new Error("Missing composer");
    }
    await act(() => type(field, "Keep across tabs"));
    composerMounted = false;
    await paint();
    composerMounted = true;
    await paint();
    expect(composer(host)?.value).toBe("Keep across tabs");
    await act(async () => {
      buttonNamed(host, "Update message")?.click();
      await Promise.resolve();
    });
    const request = fetch_.mock.calls.find(([input]) =>
      String(input).endsWith("/rewind")
    );
    expect(JSON.parse(String(request?.[1]?.body)).text).toBe(
      "Keep across tabs"
    );
  });

  it("moves the queued text into the composer", async () => {
    await render();
    await beginEdit();
    expect(composer(host)?.value).toBe("Fix it");
    expect(composer(host)?.getAttribute("aria-label")).toBe(
      "Edit queued message"
    );
  });

  it("marks the row it edits and offers a cancel", async () => {
    await render();
    await beginEdit();
    expect(editedRow(host)?.getAttribute("aria-current")).toBe("true");
    expect(host.textContent).toContain("Editing queued message:");
    expect(buttonNamed(host, "Update queued message")).not.toBeNull();
    expect(cancelButton(host)).not.toBeNull();
  });

  it("leaves the mission draft untouched through begin and cancel", async () => {
    missionDraft.change("Half-written reply");
    await render();
    await beginEdit();
    expect(composer(host)?.value).toBe("Fix it");
    await act(() => cancelButton(host)?.click());
    expect(missionDraft.snapshot()).toBe("Half-written reply");
    expect(composer(host)?.value).toBe("Half-written reply");
  });

  it("clears the row marker once the edit is cancelled", async () => {
    await render();
    await beginEdit();
    await act(() => cancelButton(host)?.click());
    expect(editedRow(host)?.getAttribute("aria-current")).toBeNull();
    expect(composer(host)?.getAttribute("aria-label")).toBe(
      "Message the Orchestrator"
    );
  });

  it("saves the edit with Enter instead of sending a message", async () => {
    await render();
    await beginEdit();
    const field = composer(host);
    if (!field) {
      throw new Error("Missing composer");
    }
    await act(() => type(field, "Fix it and add tests"));
    await act(async () => {
      field.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
        })
      );
      await Promise.resolve();
    });
    const request = fetch_.mock.calls.find(([input]) =>
      String(input).endsWith("/edit")
    );
    const body = request ? JSON.parse(String(request[1]?.body)) : null;
    expect(body).toStrictEqual({
      expectedRevision: 1,
      operationId: "operation-edit",
      text: "Fix it and add tests",
    });
  });

  it("never posts a new message while saving an edit", async () => {
    await render();
    await beginEdit();
    const field = composer(host);
    if (!field) {
      throw new Error("Missing composer");
    }
    await act(() => type(field, "Fix it and add tests"));
    await act(async () => {
      field.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
        })
      );
      await Promise.resolve();
    });
    expect(
      fetch_.mock.calls.filter(([input]) => String(input).endsWith("/messages"))
    ).toStrictEqual([]);
    expect(refresh).toHaveBeenCalledWith();
  });

  it("hands the edit back to the composer once the message was delivered", async () => {
    fetch_.mockImplementation(respond("already_sent"));
    await render();
    await beginEdit();
    const field = composer(host);
    if (!field) {
      throw new Error("Missing composer");
    }
    await act(() => type(field, "Fix it and add tests"));
    const save = buttonNamed(host, "Update queued message");
    if (!save) {
      throw new Error("Missing save button");
    }
    await act(async () => {
      save.click();
      await Promise.resolve();
    });
    expect(
      getToasts().filter(
        (shown) =>
          shown.title === "Already delivered" || shown.title === "Edit kept"
      )
    ).toHaveLength(1);
    expect(composer(host)?.getAttribute("aria-label")).toBe(
      "Message the Orchestrator"
    );
    expect(missionDraft.snapshot()).toBe("Fix it and add tests");
  });

  it("sends one request when Enter is pressed twice at once", async () => {
    await render();
    await beginEdit();
    const field = composer(host);
    if (!field) {
      throw new Error("Missing composer");
    }
    await act(async () => {
      for (const _ of [0, 1]) {
        field.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "Enter",
          })
        );
      }
      await Promise.resolve();
    });
    expect(
      fetch_.mock.calls.filter(([input]) => String(input).endsWith("/edit"))
    ).toHaveLength(1);
  });

  it("sends one request when Enter and the save button race", async () => {
    await render();
    await beginEdit();
    const field = composer(host);
    if (!field) {
      throw new Error("Missing composer");
    }
    await act(() => type(field, "Fix it and add tests"));
    const save = buttonNamed(host, "Update queued message");
    if (!save) {
      throw new Error("Missing save button");
    }
    await act(async () => {
      field.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
        })
      );
      save.click();
      await Promise.resolve();
    });
    expect(
      fetch_.mock.calls.filter(([input]) => String(input).endsWith("/edit"))
    ).toHaveLength(1);
  });

  it("keeps the previous edit when another row is opened", async () => {
    await render(["Fix it", "Also fix it"]);
    await beginEdit();
    const field = composer(host);
    if (!field) {
      throw new Error("Missing composer");
    }
    await act(() => type(field, "Half-typed change"));
    // The open row shows Cancel, so the remaining Edit button is the other one.
    const other = buttonNamed(host, "Edit queued message");
    if (!other) {
      throw new Error("Missing the other edit button");
    }
    await act(() => other.click());
    expect(missionDraft.snapshot()).toBe("Half-typed change");
    expect(composer(host)?.value).toBe("Also fix it");
  });

  it("keeps a newer edit when an old save resolves late", async () => {
    const pending = Promise.withResolvers<Response>();
    fetch_.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("composer-catalog")) {
        return Promise.resolve(new Response(CATALOG, { status: 200 }));
      }
      return url.endsWith("/edit")
        ? pending.promise
        : Promise.resolve(Response.json({}));
    });
    await render(["Fix it", "Also fix it"]);
    await beginEdit();
    const field = composer(host);
    if (!field) {
      throw new Error("Missing composer");
    }
    await act(() => type(field, "Fix it and add tests"));
    const save = buttonNamed(host, "Update queued message");
    if (!save) {
      throw new Error("Missing save button");
    }
    await act(async () => {
      save.click();
      await Promise.resolve();
    });
    // The other row still shows Edit while the save runs; it must not swap in.
    const other = buttonNamed(host, "Edit queued message");
    if (other) {
      await act(() => other.click());
    }
    expect(composer(host)?.value).toBe("Fix it and add tests");
    await act(async () => {
      pending.resolve(
        Response.json({ outcome: "replaced", replacementId: "queue-2" })
      );
      await Promise.resolve();
    });
    expect(composer(host)?.getAttribute("aria-label")).toBe(
      "Message the Orchestrator"
    );
  });

  it("lets a save that never answers be cancelled", async () => {
    const pending = Promise.withResolvers<Response>();
    fetch_.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("composer-catalog")) {
        return Promise.resolve(new Response(CATALOG, { status: 200 }));
      }
      return url.endsWith("/edit")
        ? pending.promise
        : Promise.resolve(Response.json({}));
    });
    await render(["Fix it", "Also fix it"]);
    await beginEdit();
    const field = composer(host);
    if (!field) {
      throw new Error("Missing composer");
    }
    await act(() => type(field, "Fix it and add tests"));
    const save = buttonNamed(host, "Update queued message");
    if (!save) {
      throw new Error("Missing save button");
    }
    await act(async () => {
      save.click();
      await Promise.resolve();
    });
    // Another row cannot start a save over this one, so its Edit is disabled.
    expect(
      buttonNamed(host, "Edit queued message")?.hasAttribute("disabled")
    ).toBeTruthy();
    // Cancel still works, so a stalled request cannot trap the editor.
    await act(() => cancelButton(host)?.click());
    expect(composer(host)?.getAttribute("aria-label")).toBe(
      "Message the Orchestrator"
    );
    // The request outlived the edit, so the notice must not claim otherwise.
    expect(getToasts()).toContainEqual(
      expect.objectContaining({ title: "Update may still complete" })
    );
    await act(async () => {
      pending.resolve(
        Response.json({ outcome: "replaced", replacementId: "queue-2" })
      );
      await Promise.resolve();
    });
    // The message already holds the text, so nothing is copied into the draft.
    expect(missionDraft.snapshot()).toBe("");
    expect(buttonNamed(host, "Edit queued message")).not.toBeNull();
  });

  it("returns the text when a cancelled in-flight save did not apply", async () => {
    const pending = Promise.withResolvers<Response>();
    fetch_.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("composer-catalog")) {
        return Promise.resolve(new Response(CATALOG, { status: 200 }));
      }
      return url.endsWith("/edit")
        ? pending.promise
        : Promise.resolve(Response.json({}));
    });
    await render();
    await beginEdit();
    const field = composer(host);
    if (!field) {
      throw new Error("Missing composer");
    }
    await act(() => type(field, "Fix it and add tests"));
    await act(async () => {
      buttonNamed(host, "Update queued message")?.click();
      await Promise.resolve();
    });
    await act(() => cancelButton(host)?.click());
    await act(async () => {
      pending.resolve(
        Response.json({ outcome: "delete_unconfirmed", replacementId: null })
      );
      await Promise.resolve();
    });
    // Nothing applied, so the typed text must not be lost.
    expect(missionDraft.snapshot()).toBe("Fix it and add tests");
    expect(getToasts()).toContainEqual(
      expect.objectContaining({ title: "Edit kept" })
    );
  });

  it("refuses new text while a save is in flight", async () => {
    const pending = Promise.withResolvers<Response>();
    fetch_.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("composer-catalog")) {
        return Promise.resolve(new Response(CATALOG, { status: 200 }));
      }
      return url.endsWith("/edit")
        ? pending.promise
        : Promise.resolve(Response.json({}));
    });
    await render();
    await beginEdit();
    const field = composer(host);
    if (!field) {
      throw new Error("Missing composer");
    }
    await act(() => type(field, "Fix it and add tests"));
    const save = buttonNamed(host, "Update queued message");
    if (!save) {
      throw new Error("Missing save button");
    }
    await act(async () => {
      save.click();
      await Promise.resolve();
    });
    // The request already carries its text, so the field takes no more keys.
    expect(composer(host)?.disabled).toBeTruthy();
    await act(() => {
      const next = composer(host);
      if (next) {
        type(next, "Late typing that the request cannot carry");
      }
    });
    await act(async () => {
      pending.resolve(
        Response.json({ outcome: "replaced", replacementId: "queue-2" })
      );
      await Promise.resolve();
    });
    expect(missionDraft.snapshot()).toBe("");
    expect(composer(host)?.value).toBe("");
  });

  it("saves a new edit after a stalled save was cancelled", async () => {
    const stalled = Promise.withResolvers<Response>();
    fetch_.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("composer-catalog")) {
        return Promise.resolve(new Response(CATALOG, { status: 200 }));
      }
      if (url.endsWith("/edit")) {
        return fetch_.mock.calls.filter(([seen]) =>
          String(seen).endsWith("/edit")
        ).length === 1
          ? stalled.promise
          : Promise.resolve(
              Response.json({ outcome: "replaced", replacementId: "queue-3" })
            );
      }
      return Promise.resolve(Response.json({}));
    });
    await render();
    await beginEdit();
    const field = composer(host);
    if (!field) {
      throw new Error("Missing composer");
    }
    await act(() => type(field, "First attempt"));
    const save = buttonNamed(host, "Update queued message");
    if (!save) {
      throw new Error("Missing save button");
    }
    await act(async () => {
      save.click();
      await Promise.resolve();
    });
    // The abandoned request keeps nothing locked, so a retry still reaches the
    // daemon instead of failing against a ticket it will never release.
    await act(() => cancelButton(host)?.click());
    await beginEdit();
    await act(() => type(field, "Second attempt"));
    const retry = buttonNamed(host, "Update queued message");
    if (!retry) {
      throw new Error("Missing retry button");
    }
    await act(async () => {
      retry.click();
      await Promise.resolve();
    });
    const sent = fetch_.mock.calls.filter(([seen]) =>
      String(seen).endsWith("/edit")
    );
    expect(sent).toHaveLength(2);
    expect(composer(host)?.getAttribute("aria-label")).toBe(
      "Message the Orchestrator"
    );
  });

  it("reports one failure and keeps the edit open", async () => {
    fetch_.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("composer-catalog")) {
        return Promise.resolve(new Response(CATALOG, { status: 200 }));
      }
      return url.endsWith("/edit")
        ? Promise.resolve(
            Response.json(
              { error: { code: "unavailable", message: "Edit rejected" } },
              { status: 503 }
            )
          )
        : Promise.resolve(Response.json({}));
    });
    await render();
    await beginEdit();
    const field = composer(host);
    if (!field) {
      throw new Error("Missing composer");
    }
    await act(() => type(field, "Fix it and add tests"));
    const save = buttonNamed(host, "Update queued message");
    if (!save) {
      throw new Error("Missing save button");
    }
    await act(async () => {
      save.click();
      await Promise.resolve();
    });
    expect(getToasts()).toHaveLength(1);
    expect(composer(host)?.getAttribute("aria-label")).toBe(
      "Edit queued message"
    );
    expect(
      buttonNamed(host, "Update queued message")?.hasAttribute("disabled")
    ).toBeFalsy();
  });

  it("handles a delivered exit as a delivery, not a kept edit", async () => {
    await render();
    await beginEdit();
    const field = composer(host);
    if (!field) {
      throw new Error("Missing composer");
    }
    await act(() => type(field, "Fix it and add tests"));
    await repaint(["Fix it"], "sent");
    await act(nextFrame);
    expect(composer(host)?.getAttribute("aria-label")).toBe(
      "Message the Orchestrator"
    );
    expect(getToasts()).toContainEqual(
      expect.objectContaining({ title: "Already delivered" })
    );
    // The agent received it, so the text is offered back without a resend.
    expect(missionDraft.snapshot()).toBe("Fix it and add tests");
  });

  it("keeps a discarded exit away from an existing draft", async () => {
    missionDraft.change("Other draft");
    await render();
    await beginEdit();
    const field = composer(host);
    if (!field) {
      throw new Error("Missing composer");
    }
    await act(() => type(field, "Fix it and add tests"));
    await repaint([], "accepted");
    await act(nextFrame);
    expect(missionDraft.snapshot()).toBe("Other draft");
    expect(getToasts()).toContainEqual(
      expect.objectContaining({ title: "Edit discarded" })
    );
  });

  it("keeps the edit open when the daemon cannot confirm the delete", async () => {
    fetch_.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("composer-catalog")) {
        return Promise.resolve(new Response(CATALOG, { status: 200 }));
      }
      return url.endsWith("/edit")
        ? Promise.resolve(
            Response.json({
              outcome: "delete_unconfirmed",
              replacementId: null,
            })
          )
        : Promise.resolve(Response.json({}));
    });
    await render();
    await beginEdit();
    const field = composer(host);
    if (!field) {
      throw new Error("Missing composer");
    }
    await act(() => type(field, "Fix it and add tests"));
    await act(async () => {
      buttonNamed(host, "Update queued message")?.click();
      await Promise.resolve();
    });
    expect(getToasts()).toContainEqual(
      expect.objectContaining({ title: "Edit not sent" })
    );
    expect(composer(host)?.getAttribute("aria-label")).toBe(
      "Edit queued message"
    );
    expect(composer(host)?.value).toBe("Fix it and add tests");
    expect(
      buttonNamed(host, "Update queued message")?.hasAttribute("disabled")
    ).toBeFalsy();
  });

  it("opens the newest queued edit with Alt+ArrowUp at the caret", async () => {
    await render(["Older message", "Newer message"]);
    const field = composer(host);
    if (!field) {
      throw new Error("Missing composer");
    }
    await act(() => {
      field.setSelectionRange(0, 0);
      field.dispatchEvent(
        new KeyboardEvent("keydown", {
          altKey: true,
          bubbles: true,
          cancelable: true,
          key: "ArrowUp",
        })
      );
    });
    expect(composer(host)?.value).toBe("Newer message");
    expect(composer(host)?.getAttribute("aria-label")).toBe(
      "Edit queued message"
    );
  });

  it("leaves Alt+ArrowUp alone when the caret is inside the text", async () => {
    await render(["Older message", "Newer message"]);
    const field = composer(host);
    if (!field) {
      throw new Error("Missing composer");
    }
    await act(() => type(field, "A reply in progress"));
    await act(() => {
      field.setSelectionRange(6, 6);
      field.dispatchEvent(
        new KeyboardEvent("keydown", {
          altKey: true,
          bubbles: true,
          cancelable: true,
          key: "ArrowUp",
        })
      );
    });
    // ArrowUp still moves the caret here instead of opening another edit.
    expect(composer(host)?.getAttribute("aria-label")).toBe(
      "Message the Orchestrator"
    );
    expect(composer(host)?.value).toBe("A reply in progress");
  });

  it("takes no attachments while a queued message is being edited", async () => {
    await render();
    await beginEdit();
    // The attach control is gone, and a drop must not slip past it.
    expect(buttonNamed(host, "Attach files")).toBeUndefined();
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.assign(drop, {
      dataTransfer: { files: [new File(["x"], "late.txt")], types: ["Files"] },
    });
    await act(() => {
      composer(host)?.dispatchEvent(drop);
      return Promise.resolve();
    });
    expect(
      fetch_.mock.calls.filter(([input]) =>
        String(input).endsWith("/attachments")
      )
    ).toStrictEqual([]);
    expect(host.querySelector('[aria-label="Attachments"]')).toBeNull();
  });

  it("settles two cancelled saves independently", async () => {
    const first = Promise.withResolvers<Response>();
    const second = Promise.withResolvers<Response>();
    const answers = [first.promise, second.promise];
    let edits = 0;
    fetch_.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("composer-catalog")) {
        return Promise.resolve(new Response(CATALOG, { status: 200 }));
      }
      if (!url.endsWith("/edit")) {
        return Promise.resolve(Response.json({}));
      }
      const answer = answers[edits] ?? Promise.resolve(Response.json({}));
      edits += 1;
      return answer;
    });
    await render();
    await beginEdit();
    const field = composer(host);
    if (!field) {
      throw new Error("Missing composer");
    }
    await act(() => type(field, "First edit"));
    await act(async () => {
      buttonNamed(host, "Update queued message")?.click();
      await Promise.resolve();
    });
    await act(() => cancelButton(host)?.click());
    await beginEdit();
    await act(() => type(field, "Second edit"));
    await act(async () => {
      buttonNamed(host, "Update queued message")?.click();
      await Promise.resolve();
    });
    await act(() => cancelButton(host)?.click());
    // Both requests outlived their edits; neither answer may be dropped.
    await act(async () => {
      first.resolve(
        Response.json({ outcome: "delete_unconfirmed", replacementId: null })
      );
      await Promise.resolve();
    });
    await act(async () => {
      second.resolve(
        Response.json({ outcome: "replaced", replacementId: "q" })
      );
      await Promise.resolve();
    });
    // The first did not apply, so its text comes back even though a second
    // save was held after it.
    expect(missionDraft.snapshot()).toBe("First edit");
  });

  it("keeps the save action disabled while the edit is empty", async () => {
    await render();
    await beginEdit();
    const field = composer(host);
    if (!field) {
      throw new Error("Missing composer");
    }
    await act(() => type(field, "   "));
    expect(
      buttonNamed(host, "Update queued message")?.hasAttribute("disabled")
    ).toBeTruthy();
  });
});
