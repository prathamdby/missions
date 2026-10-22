import { describe, expect, it } from "vitest";

import { NativeQueueTracker } from "./native-queue";
import type { NativeQueueEntry } from "./native-queue";

const setup = () => {
  const changes: NativeQueueEntry[] = [];
  const tracker = new NativeQueueTracker((entry) => changes.push(entry));
  return { changes, tracker };
};

describe(NativeQueueTracker, () => {
  it("treats the add response as admission, not consumption", () => {
    const { tracker } = setup();
    tracker.submitted("a", "hi", "steer");
    tracker.admitted("a");
    expect(tracker.get("a")?.state).toBe("queued");
    tracker.consumed("a");
    expect(tracker.get("a")?.state).toBe("sent");
  });

  it("keeps sent when consumption is observed before the add response", () => {
    const { tracker } = setup();
    tracker.submitted("a", "hi", "queue");
    tracker.consumed("a");
    tracker.admitted("a");
    expect(tracker.get("a")?.state).toBe("sent");
  });

  it("marks transport failures unknown and protocol rejections failed", () => {
    const { tracker } = setup();
    tracker.submitted("a", "x", "steer");
    tracker.submitted("b", "y", "steer");
    tracker.submitFailed("a", "timeout", false);
    tracker.submitFailed("b", "rejected", true);
    expect(tracker.get("a")?.state).toBe("unknown");
    expect(tracker.get("b")?.state).toBe("failed");
  });

  it("reports consumption that races a removal honestly", () => {
    const { tracker } = setup();
    tracker.submitted("a", "fix", "queue");
    tracker.admitted("a");
    tracker.removing("a");
    tracker.consumed("a");
    tracker.removeConfirmed("a");
    const entry = tracker.get("a");
    expect(entry?.state).toBe("sent");
    expect(entry?.error).toBe("Delivered before removal took effect");
  });

  it("attributes a discard without request ID only on an unambiguous match", () => {
    const { tracker } = setup();
    tracker.submitted("a", "one", "steer");
    tracker.submitted("b", "two", "steer");
    tracker.submitted("c", "two", "queue");
    for (const id of ["a", "b", "c"]) {
      tracker.admitted(id);
    }
    tracker.discarded(undefined, "one");
    expect(tracker.get("a")?.state).toBe("discarded");
    tracker.discarded(undefined, "two");
    expect(tracker.get("b")?.state).toBe("unknown");
    expect(tracker.get("c")?.state).toBe("unknown");
  });

  it("marks combined discard text candidates unknown", () => {
    const { tracker } = setup();
    tracker.submitted("a", "alpha", "steer");
    tracker.submitted("b", "beta", "steer");
    tracker.admitted("a");
    tracker.admitted("b");
    tracker.discarded(undefined, "alpha\n\nbeta");
    expect(tracker.get("a")?.state).toBe("unknown");
    expect(tracker.get("b")?.state).toBe("unknown");
  });

  it("never regresses terminal states", () => {
    const { tracker } = setup();
    tracker.submitted("a", "x", "steer");
    tracker.consumed("a");
    tracker.discarded("a", "x");
    tracker.removing("a");
    tracker.modeChanged("a", "queue");
    expect(tracker.get("a")).toMatchObject({ mode: "steer", state: "sent" });
  });

  it("reconciles restored native state without resubmitting", () => {
    const { tracker } = setup();
    for (const id of ["q", "p", "c", "gone", "rm"]) {
      tracker.submitted(id, id, "queue");
      tracker.admitted(id);
    }
    tracker.removing("rm");
    tracker.reconcile({
      consumedIds: new Set(["c"]),
      pendingIds: ["p"],
      queuedIds: ["q"],
    });
    expect(tracker.get("q")?.state).toBe("queued");
    expect(tracker.get("p")?.state).toBe("sent");
    expect(tracker.get("c")?.state).toBe("sent");
    expect(tracker.get("gone")?.state).toBe("unknown");
    expect(tracker.get("rm")?.state).toBe("removed");
  });
});
