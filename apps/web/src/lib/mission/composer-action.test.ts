import { MissionStatusSchema } from "@missions/protocol/missions";
import type { AgentStatus, MissionStatus } from "@missions/protocol/missions";
import { describe, expect, it } from "vitest";

import { composerAction } from "./composer-action";
import type { ComposerAction, PendingControl } from "./composer-action";

const working = [{ status: "working" as AgentStatus }];
const idle = [{ status: "idle" as AgentStatus }];

const SEND: ComposerAction = { enabled: true, kind: "send" };
const DISABLED: ComposerAction = { enabled: false, kind: "send" };
const PAUSE: ComposerAction = { kind: "pause" };
const RESUME: ComposerAction = { kind: "resume", label: "Resume" };
const RETRY: ComposerAction = { kind: "resume", label: "Retry" };
const PAUSING: ComposerAction = { kind: "progress", label: "Pausing…" };

/** Expected action per status for [empty draft, typed draft], with agents working. */
const TABLE: Record<MissionStatus, [ComposerAction, ComposerAction]> = {
  archived: [DISABLED, DISABLED],
  awaiting_approval: [PAUSE, SEND],
  completed: [DISABLED, DISABLED],
  exploring: [PAUSE, SEND],
  failed: [RETRY, RETRY],
  interrupted: [RESUME, RESUME],
  paused: [RESUME, RESUME],
  pausing: [PAUSING, PAUSING],
  running: [PAUSE, SEND],
  setting_up: [PAUSE, SEND],
  stop_failed: [RETRY, RETRY],
};

describe(composerAction, () => {
  it("picks one action for every status and draft while agents work", () => {
    for (const status of MissionStatusSchema.options) {
      expect([
        composerAction({
          agents: working,
          hasDraft: false,
          pending: null,
          status,
        }),
        composerAction({
          agents: working,
          hasDraft: true,
          pending: null,
          status,
        }),
      ]).toStrictEqual(TABLE[status]);
    }
  });

  it("does not offer Pause when every agent in an active mission is idle", () => {
    for (const status of [
      "running",
      "exploring",
      "awaiting_approval",
    ] as const) {
      expect(
        composerAction({ agents: idle, hasDraft: false, pending: null, status })
      ).toStrictEqual(DISABLED);
    }
    expect(
      composerAction({
        agents: [],
        hasDraft: false,
        pending: null,
        status: "running",
      })
    ).toStrictEqual(DISABLED);
    expect(
      composerAction({
        agents: [{ status: "starting" }],
        hasDraft: false,
        pending: null,
        status: "running",
      })
    ).toStrictEqual(PAUSE);
    expect(
      composerAction({
        agents: [],
        hasDraft: false,
        pending: null,
        status: "setting_up",
      })
    ).toStrictEqual(PAUSE);
  });

  it("keeps Pause available with no draft content", () => {
    expect(
      composerAction({
        agents: working,
        hasDraft: false,
        pending: null,
        status: "running",
      })
    ).toStrictEqual(PAUSE);
  });

  it("shows progress while any control is pending, whatever the draft", () => {
    const cases: [PendingControl, MissionStatus, string][] = [
      ["pause", "running", "Pausing…"],
      ["resume", "paused", "Resuming…"],
      ["resume", "interrupted", "Resuming…"],
      ["resume", "failed", "Retrying…"],
      ["resume", "stop_failed", "Retrying…"],
      ["archive", "completed", "Archiving…"],
      ["delete", "completed", "Deleting…"],
    ];
    for (const [pending, status, label] of cases) {
      for (const hasDraft of [false, true]) {
        expect(
          composerAction({ agents: working, hasDraft, pending, status })
        ).toStrictEqual({ kind: "progress", label });
      }
    }
  });
});
