import { describe, expect, it } from "vitest";

import { NativeQueueTracker } from "./native-queue";
import type { NativeQueueEntry } from "./native-queue";

const setup = () => {
  const changes: NativeQueueEntry[] = [];
  const tracker = new NativeQueueTracker((entry) => changes.push(entry));
  return { changes, tracker };
};

describe(NativeQueueTracker, () => {
  it("lets restored consumption override an earlier removal claim", () => {
    const { tracker } = setup();
    tracker.hydrate([
      { error: null, id: "old", mode: "queue", state: "removed", text: "text" },
    ]);
    tracker.reconcile({
      consumedIds: new Set(["old"]),
      pendingIds: [],
      queuedIds: [],
    });
    expect(tracker.get("old")?.state).toBe("sent");
  });

  it("bounds terminal history without dropping unresolved identities", () => {
    const tracker = new NativeQueueTracker(() => {}, 2);
    tracker.submitted("unknown", "unresolved", "queue");
    tracker.submitFailed("unknown", "timeout", false);
    for (let i = 0; i < 10; i += 1) {
      tracker.submitted(`internal-${i}`, "internal", "steer");
      tracker.consumed(`internal-${i}`);
    }
    expect(tracker.list()).toHaveLength(3);
    expect(tracker.get("internal-0")).toBeNull();
    expect(tracker.get("unknown")?.state).toBe("unknown");
    tracker.reconcile({
      consumedIds: new Set(["unknown"]),
      pendingIds: [],
      queuedIds: [],
    });
    expect(tracker.get("unknown")?.state).toBe("sent");
    expect(tracker.list()).toHaveLength(2);
  });

  it("retains in-flight removal identities across terminal pruning", () => {
    const tracker = new NativeQueueTracker(() => {}, 1);
    tracker.submitted("editing", "text", "queue");
    const release = tracker.retain("editing");
    tracker.removeConfirmed("editing");
    tracker.submitted("internal", "text", "queue");
    tracker.consumed("internal");
    tracker.consumed("editing");
    expect(tracker.get("editing")?.state).toBe("sent");
    release();
    expect(tracker.list()).toHaveLength(1);
  });

  it("bounds restored terminal history while keeping every open entry", () => {
    const tracker = new NativeQueueTracker(() => {}, 1);
    tracker.hydrate([
      { error: null, id: "old", mode: "queue", state: "sent", text: "old" },
      {
        error: null,
        id: "open",
        mode: "queue",
        state: "unknown",
        text: "open",
      },
      { error: null, id: "new", mode: "queue", state: "removed", text: "new" },
    ]);
    expect(tracker.list().map((entry) => entry.id)).toStrictEqual([
      "open",
      "new",
    ]);
  });

  it("treats the add response as admission, not consumption", () => {
    const { tracker } = setup();
    tracker.submitted("a", "hi", "steer");
    tracker.admitted("a");
    expect(tracker.get("a")?.state).toBe("queued");
    tracker.consumed("a");
    expect(tracker.get("a")?.state).toBe("sent");
  });

  it.each(["submitting", "sent", "removed", "discarded"] as const)(
    "reconciles a late ACK after timeout without regressing %s",
    (state) => {
      const { tracker } = setup();
      tracker.submitted("late", "text", "steer");
      if (state === "sent") {
        tracker.consumed("late");
      }
      if (state === "removed") {
        tracker.removeConfirmed("late");
      }
      if (state === "discarded") {
        tracker.discarded("late", "text");
      }
      tracker.submitFailed("late", "timeout", false);
      expect(tracker.get("late")?.state).toBe(
        state === "submitting" ? "unknown" : state
      );
      const previousError = tracker.get("late")?.error;
      tracker.admitted("late");
      expect(tracker.get("late")).toMatchObject({
        error: state === "submitting" ? null : previousError,
        state: state === "submitting" ? "queued" : state,
      });
    }
  );

  it("reconciles late rejection, removal and consumption after uncertain submission without replay", () => {
    const { tracker } = setup();
    tracker.submitted("late", "text", "steer");
    tracker.submitFailed("late", "timeout", false);
    tracker.removing("late");
    tracker.admitted("late");
    expect(tracker.get("late")?.state).toBe("removing");
    tracker.removeConfirmed("late");
    tracker.submitFailed("late", "late rejection", true);
    expect(tracker.get("late")?.state).toBe("removed");
    tracker.consumed("late");
    tracker.admitted("late");
    tracker.submitFailed("late", "disconnected", false);
    expect(tracker.get("late")?.state).toBe("sent");
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
