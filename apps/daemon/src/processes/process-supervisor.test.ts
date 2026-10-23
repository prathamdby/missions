import { ChildProcess, spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";

import { describe, expect, it, vi } from "vitest";

import { sleep } from "../lib/async";
import type { ProcessTable, ProcStat } from "./proc-table";
import { parseProcStat, ProcessSupervisor } from "./process-supervisor";
import type { ProcessRecord } from "./process-supervisor";

class MemoryProcessTable implements ProcessTable {
  readonly processes = new Map<number, ProcStat & { tag: string }>();
  readonly signals: number[] = [];
  unreadable = false;
  unreadablePid: number | null = null;
  unreadableEnvironmentPid: number | null = null;
  beforeStat: ((pid: number) => void) | null = null;

  pids() {
    if (this.unreadable) {
      return Promise.reject(new Error("Process table is unreadable"));
    }
    return Promise.resolve([...this.processes.keys()]);
  }

  stat(pid: number): Promise<ProcStat | null> {
    this.beforeStat?.(pid);
    if (pid === this.unreadablePid) {
      return Promise.reject(new Error("Process stat is unreadable"));
    }
    return Promise.resolve(this.processes.get(pid) ?? null);
  }

  hasTag(pid: number, tag: string) {
    if (pid === this.unreadableEnvironmentPid) {
      return Promise.reject(new Error("Process environment is unreadable"));
    }
    return Promise.resolve(this.processes.get(pid)?.tag === tag);
  }

  signal(pid: number) {
    this.signals.push(pid);
    this.processes.delete(pid);
  }

  add(pid: number, tag: string, startTime = "100", group = pid) {
    this.processes.set(pid, {
      pgrp: group,
      pid,
      session: group,
      startTime,
      state: "S",
      tag,
    });
  }
}

const fakeChild = (pid: number) => {
  const child = new ChildProcess();
  Object.defineProperty(child, "pid", { value: pid });
  return child;
};

const memorySupervisor = () => {
  const table = new MemoryProcessTable();
  const saved: (ProcessRecord | null)[] = [];
  const supervisor = new ProcessSupervisor({
    binDir: "/unused",
    droidPath: "/unused",
    onRecord: (record) => saved.push(record),
    processTable: table,
  });
  return { saved, supervisor, table };
};

describe("deterministic process supervision", () => {
  it("does not claim cleanup when ownership identity is unavailable", async () => {
    const { supervisor } = memorySupervisor();
    await expect(
      supervisor.stopRecord({
        agentId: "agent",
        pid: 41,
        startTime: "",
        tag: "",
      })
    ).resolves.toMatchObject({ stopped: false, unobservable: true });
  });

  it("does not erase ownership when tag observation fails", async () => {
    const { supervisor, table } = memorySupervisor();
    table.add(42, "owned");
    table.unreadableEnvironmentPid = 42;
    await expect(
      supervisor.stopRecord({
        agentId: "agent",
        pid: 41,
        startTime: "",
        tag: "owned",
      })
    ).resolves.toMatchObject({ stopped: false, unobservable: true });
    expect(table.signals).toHaveLength(0);
  });

  it("excludes provably prelaunch processes without hiding newer observation failures", async () => {
    const { supervisor, table } = memorySupervisor();
    table.add(40, "", "1");
    table.unreadableEnvironmentPid = 40;
    const record = {
      agentId: "agent",
      minimumStartTime: "50",
      pid: 41,
      startTime: "",
      tag: "owned",
    };
    await expect(supervisor.stopRecord(record)).resolves.toMatchObject({
      stopped: true,
    });
    table.add(40, "", "100");
    await expect(supervisor.stopRecord(record)).resolves.toMatchObject({
      stopped: false,
      unobservable: true,
    });
  });

  it("rechecks group authority if the leader PID is reused during observation", async () => {
    const { supervisor, table } = memorySupervisor();
    table.add(41, "owned", "100");
    let reads = 0;
    table.beforeStat = (pid) => {
      if (pid === 41) {
        reads += 1;
        if (reads === 2) {
          table.add(41, "unrelated", "999");
        }
      }
    };
    await expect(
      supervisor.stopRecord({
        agentId: "agent",
        pid: 41,
        startTime: "100",
        tag: "owned",
      })
    ).resolves.toMatchObject({ stopped: true });
    expect(table.signals).toHaveLength(0);
  });

  it("persists tag ownership before observing a fast-exiting leader", async () => {
    const { saved, supervisor, table } = memorySupervisor();
    const env = supervisor.launchEnv("agent");
    table.add(42, env.MISSIONS_AGENT_TAG ?? "");
    table.beforeStat = () => {
      expect(saved[0]).toMatchObject({ pid: 41, startTime: "" });
    };
    supervisor.register("agent", fakeChild(41));
    expect(saved).toHaveLength(1);
    await expect(supervisor.stop("agent")).resolves.toStrictEqual({
      stopped: true,
      survivors: [],
    });
    expect(table.signals).toStrictEqual([42]);
    expect(saved.at(-1)).toBeNull();
  });

  it("enriches the persisted identity only when the inherited tag matches", async () => {
    const { saved, supervisor, table } = memorySupervisor();
    const env = supervisor.launchEnv("agent");
    table.add(41, env.MISSIONS_AGENT_TAG ?? "", "123");
    supervisor.register("agent", fakeChild(41));
    await nextTurn();
    expect(saved).toHaveLength(2);
    expect(saved[0]?.startTime).toBe("");
    expect(saved.at(-1)?.startTime).toBe("123");
  });

  it.each([
    { stage: "stat", stopMethod: "stop" },
    { stage: "tag", stopMethod: "stop" },
    { stage: "stat", stopMethod: "stopRecord" },
    { stage: "tag", stopMethod: "stopRecord" },
  ] as const)(
    "invalidates deferred $stage enrichment at $stopMethod admission despite unconfirmed exit",
    async ({ stage, stopMethod }) => {
      const { saved, supervisor, table } = memorySupervisor();
      const env = supervisor.launchEnv("agent");
      table.add(41, env.MISSIONS_AGENT_TAG ?? "", "123");
      const stat = table.processes.get(41) ?? null;
      const statGate = Promise.withResolvers<ProcStat | null>();
      const tagGate = Promise.withResolvers<boolean>();
      const entered = Promise.withResolvers<undefined>();
      if (stage === "stat") {
        vi.spyOn(table, "stat").mockImplementationOnce(() => {
          entered.resolve(undefined);
          return statGate.promise;
        });
      } else {
        vi.spyOn(table, "hasTag").mockImplementationOnce(() => {
          entered.resolve(undefined);
          return tagGate.promise;
        });
      }
      supervisor.register("agent", fakeChild(41));
      await entered.promise;
      const record = supervisor.record("agent");
      if (!record) {
        throw new Error("The immediate launch record is missing");
      }
      expect(saved).toHaveLength(1);
      table.unreadable = true;
      const stopping =
        stopMethod === "stop"
          ? supervisor.stop("agent")
          : supervisor.stopRecord(record);
      await expect(stopping).resolves.toMatchObject({
        stopped: false,
        unobservable: true,
      });
      // The owner can now close persistence. Completing the deferred I/O must
      // neither enrich the retained record nor invoke its persistence callback.
      statGate.resolve(stat);
      tagGate.resolve(true);
      await nextTurn();
      expect({ record: supervisor.record("agent"), saved }).toStrictEqual({
        record,
        saved: [record],
      });
      table.unreadable = false;
      await expect(supervisor.stop("agent")).resolves.toMatchObject({
        stopped: true,
      });
      expect({ cleared: saved.at(-1), signals: table.signals }).toStrictEqual({
        cleared: null,
        signals: [41],
      });
    }
  );

  it("does not let a replaced launch enrich or overwrite the current generation", async () => {
    const { saved, supervisor, table } = memorySupervisor();
    const oldEnv = supervisor.launchEnv("agent");
    table.add(41, oldEnv.MISSIONS_AGENT_TAG ?? "", "123");
    const oldStat = table.processes.get(41) ?? null;
    const deferred = Promise.withResolvers<ProcStat | null>();
    vi.spyOn(table, "stat").mockReturnValueOnce(deferred.promise);
    supervisor.register("agent", fakeChild(41));

    const newEnv = supervisor.launchEnv("agent");
    table.add(42, newEnv.MISSIONS_AGENT_TAG ?? "", "456");
    supervisor.register("agent", fakeChild(42));
    await nextTurn();
    expect(supervisor.record("agent")).toMatchObject({
      pid: 42,
      startTime: "456",
    });
    expect(saved).toHaveLength(3);
    deferred.resolve(oldStat);
    await nextTurn();
    expect(saved).toHaveLength(3);
    expect(saved.at(-1)).toMatchObject({ pid: 42, startTime: "456" });
  });

  it("does not let a stale stop for a reused PID invalidate replacement enrichment", async () => {
    const { saved, supervisor, table } = memorySupervisor();
    const oldEnv = supervisor.launchEnv("agent");
    table.add(41, oldEnv.MISSIONS_AGENT_TAG ?? "", "123");
    supervisor.register("agent", fakeChild(41));
    await nextTurn();
    const previous = supervisor.record("agent");
    expect(previous?.startTime).toBe("123");
    if (!previous) {
      throw new Error("The previous launch record is missing");
    }
    const newEnv = supervisor.launchEnv("agent");
    table.add(41, newEnv.MISSIONS_AGENT_TAG ?? "", "456");
    const newStat = table.processes.get(41) ?? null;
    const deferred = Promise.withResolvers<ProcStat | null>();
    vi.spyOn(table, "stat").mockReturnValueOnce(deferred.promise);
    supervisor.register("agent", fakeChild(41));
    table.unreadable = true;
    await expect(supervisor.stopRecord(previous)).resolves.toMatchObject({
      stopped: false,
      unobservable: true,
    });
    deferred.resolve(newStat);
    await nextTurn();
    expect(saved).toHaveLength(4);
    expect(supervisor.record("agent")).toMatchObject({
      pid: 41,
      startTime: "456",
    });
  });

  it("retains ownership on unreadable process observations and permits retry", async () => {
    const { saved, supervisor, table } = memorySupervisor();
    supervisor.launchEnv("agent");
    supervisor.register("agent", fakeChild(41));
    table.unreadable = true;
    await expect(supervisor.members(41)).rejects.toThrow(/observed/u);
    await expect(supervisor.stop("agent")).resolves.toStrictEqual({
      stopped: false,
      survivors: [],
      unobservable: true,
    });
    expect(supervisor.record("agent")).not.toBeNull();
    expect(saved.at(-1)).not.toBeNull();
    table.unreadable = false;
    await expect(supervisor.stop("agent")).resolves.toStrictEqual({
      stopped: true,
      survivors: [],
    });
  });

  it("does not mistake unreadable individual stats for absent processes", async () => {
    const { supervisor, table } = memorySupervisor();
    table.add(42, "owned");
    table.unreadablePid = 42;
    await expect(
      supervisor.stopRecord({
        agentId: "agent",
        pid: 41,
        startTime: "",
        tag: "owned",
      })
    ).resolves.toMatchObject({ stopped: false, unobservable: true });
    expect(table.signals).toHaveLength(0);
  });

  it("uses only the tag when a leader PID is reused", async () => {
    const { supervisor, table } = memorySupervisor();
    table.add(41, "unrelated", "999");
    table.add(42, "unrelated", "1000", 41);
    table.add(43, "owned", "101");
    await expect(
      supervisor.stopRecord({
        agentId: "agent",
        pid: 41,
        startTime: "100",
        tag: "owned",
      })
    ).resolves.toMatchObject({ stopped: true });
    expect(table.signals).toStrictEqual([43]);
    expect([...table.processes.keys()]).toStrictEqual([41, 42]);
  });

  it("revalidates a member identity before signalling it", async () => {
    const { supervisor, table } = memorySupervisor();
    table.add(42, "owned");
    let reads = 0;
    table.beforeStat = (pid) => {
      if (pid === 42) {
        reads += 1;
        if (reads === 2) {
          table.add(42, "unrelated", "999");
        }
      }
    };
    await expect(
      supervisor.stopRecord({
        agentId: "agent",
        pid: 41,
        startTime: "",
        tag: "owned",
      })
    ).resolves.toMatchObject({ stopped: true });
    expect(table.signals).toHaveLength(0);
  });

  it("keeps legacy group/session ownership when a verified leader exited", async () => {
    const { supervisor, table } = memorySupervisor();
    table.add(42, "", "101", 41);
    await expect(
      supervisor.stopRecord({
        agentId: "agent",
        pid: 41,
        startTime: "100",
        tag: "",
      })
    ).resolves.toMatchObject({ stopped: true });
    expect(table.signals).toStrictEqual([42]);
  });
});

describe(parseProcStat, () => {
  it("reads group, session and start time even with spaces in comm", () => {
    const raw =
      "4242 (my proc) S 1 4242 4242 0 -1 4194560 0 0 0 0 0 0 0 0 20 0 1 0 987654 0 0";
    expect(parseProcStat(raw)).toStrictEqual({
      pgrp: 4242,
      pid: 4242,
      session: 4242,
      startTime: "987654",
      state: "S",
    });
  });
});

describe.runIf(process.platform === "linux")(ProcessSupervisor, () => {
  it("stops a whole session including detached tagged descendants", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "missions-sup-"));
    const supervisor = new ProcessSupervisor({
      binDir: dir,
      droidPath: "/bin/sh",
    });
    const launcher = await supervisor.ensureLauncher();
    const env = { ...process.env, ...supervisor.launchEnv("agent") };
    // Foreground child, a backgrounded child, and a child that leaves the session.
    const child = spawn(
      launcher,
      ["-c", "sleep 61 & setsid sleep 62 & sleep 63"],
      { env, stdio: "ignore" }
    );
    supervisor.register("agent", child);
    await sleep(300);
    const record = supervisor.record("agent");
    const members = await supervisor.members(record?.pid ?? -1, record?.tag);
    expect(members.length).toBeGreaterThanOrEqual(4);
    await expect(
      supervisor.stop("agent", { graceMs: 500 })
    ).resolves.toStrictEqual({
      stopped: true,
      survivors: [],
    });
    expect(supervisor.record("agent")).toBeNull();
  });
});
