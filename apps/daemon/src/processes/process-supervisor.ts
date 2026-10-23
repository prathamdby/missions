import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { pollUntil } from "../lib/async";
import { LinuxProcessTable, TAG_VARIABLE } from "./proc-table";
import type { ProcessTable, ProcStat } from "./proc-table";

export { parseProcStat, TAG_VARIABLE } from "./proc-table";

/**
 * A setsid launch owns a group/session and an inherited environment tag for
 * detached descendants. This is process cleanup, not a security sandbox:
 * changing UID or scrubbing the environment and detaching escapes the tag.
 */
export interface ProcessRecord {
  agentId: string;
  pid: number;
  /** Empty until captured; never use an unverified PID as group authority. */
  startTime: string;
  tag: string;
  /** Persisted lower bound also works when a fast-exiting leader was missed. */
  minimumStartTime?: string;
}

export interface StopResult {
  stopped: boolean;
  survivors: number[];
  /** Absence could not be confirmed. Keep ownership and retry cleanup. */
  unobservable?: boolean;
}

export interface ProcessSupervisorOptions {
  binDir: string;
  droidPath: string;
  procRoot?: string;
  processTable?: ProcessTable;
  onRecord?: (record: ProcessRecord | null, agentId: string) => void;
  onSignal?: (signal: NodeJS.Signals, pids: number[]) => void;
}

interface Observation {
  members: ProcStat[];
  unobservable: boolean;
}

const POLL_MS = 50;

export class ProcessSupervisor {
  readonly #options: ProcessSupervisorOptions;
  readonly #table: ProcessTable;
  readonly #records = new Map<string, ProcessRecord>();
  readonly #tags = new Map<string, string>();
  readonly #enriching = new WeakSet<ProcessRecord>();
  #launcherPath: string | null = null;

  constructor(options: ProcessSupervisorOptions) {
    this.#options = options;
    this.#table =
      options.processTable ?? new LinuxProcessTable(options.procRoot);
  }

  async ensureLauncher(): Promise<string> {
    if (this.#launcherPath) {
      return this.#launcherPath;
    }
    await mkdir(this.#options.binDir, { recursive: true });
    const launcher = path.join(this.#options.binDir, "droid-session-leader.sh");
    await writeFile(
      launcher,
      '#!/bin/sh\nexec setsid "$MISSIONS_DROID_BIN" "$@"\n',
      { mode: 0o755 }
    );
    await chmod(launcher, 0o755);
    this.#launcherPath = launcher;
    return launcher;
  }

  launchEnv(agentId: string): Record<string, string> {
    const tag = `${agentId}.${randomUUID()}`;
    this.#tags.set(agentId, tag);
    return { MISSIONS_DROID_BIN: this.#options.droidPath, [TAG_VARIABLE]: tag };
  }

  register(agentId: string, child: ChildProcess) {
    const { pid } = child;
    if (pid === undefined) {
      return;
    }
    const record: ProcessRecord = {
      agentId,
      pid,
      startTime: "",
      tag: this.#tags.get(agentId) ?? "",
      ...(this.#table.launchFloor
        ? { minimumStartTime: this.#table.launchFloor }
        : {}),
    };
    const previous = this.#records.get(agentId);
    if (previous) {
      this.#enriching.delete(previous);
    }
    this.#records.set(agentId, record);
    this.#enriching.add(record);
    // Persist ownership synchronously, before any /proc await. A leader can
    // exit immediately while tagged, detached children remain alive.
    this.#options.onRecord?.({ ...record }, agentId);
    void this.#captureStartTime(agentId, record);
  }

  async #captureStartTime(agentId: string, record: ProcessRecord) {
    try {
      const stat = await this.#table.stat(record.pid);
      if (!this.#enriching.has(record) || !stat || !record.tag) {
        return;
      }
      const tagged = await this.#table.hasTag(record.pid, record.tag);
      if (!this.#enriching.has(record) || !tagged) {
        return;
      }
      const latest = await this.#table.stat(record.pid);
      if (
        latest?.startTime === stat.startTime &&
        this.#records.get(agentId) === record &&
        this.#enriching.has(record)
      ) {
        record.startTime = stat.startTime;
        this.#options.onRecord?.({ ...record }, agentId);
      }
    } catch {
      // The already-persisted tag remains valid even without leader identity.
    } finally {
      this.#enriching.delete(record);
    }
  }

  record(agentId: string) {
    const record = this.#records.get(agentId);
    return record ? { ...record } : null;
  }

  /** Public observation must not turn an unreadable /proc into an empty set. */
  async members(leaderPid: number, tag = ""): Promise<number[]> {
    const record = [...this.#records.values()].find(
      (entry) => entry.pid === leaderPid && entry.tag === tag
    );
    const observation = record
      ? await this.#observeRecord(record)
      : await this.#observe(leaderPid, tag);
    if (observation.unobservable) {
      throw new Error("Process membership could not be observed");
    }
    return observation.members.map((stat) => stat.pid);
  }

  async #observe(
    leaderPid: number,
    tag: string,
    minimumStartTime = ""
  ): Promise<Observation> {
    const observation: Observation = { members: [], unobservable: false };
    let pids: number[];
    try {
      pids = await this.#table.pids();
    } catch {
      return { members: [], unobservable: true };
    }
    await Promise.all(
      pids.map(async (pid) => {
        try {
          const stat = await this.#table.stat(pid);
          if (
            !stat ||
            stat.state === "Z" ||
            (minimumStartTime !== "" &&
              BigInt(stat.startTime) < BigInt(minimumStartTime))
          ) {
            return;
          }
          if (
            (leaderPid > 0 &&
              (stat.pgrp === leaderPid || stat.session === leaderPid)) ||
            (tag !== "" && (await this.#table.hasTag(pid, tag)))
          ) {
            observation.members.push(stat);
          }
        } catch {
          observation.unobservable = true;
        }
      })
    );
    return observation;
  }

  async #scope(record: ProcessRecord) {
    // With no captured identity, only the tag proves ownership. Legacy
    // records with captured startTime continue to own an exited leader's group.
    if (!record.startTime) {
      return -1;
    }
    const leader = await this.#table.stat(record.pid);
    return leader && leader.startTime !== record.startTime ? -1 : record.pid;
  }

  async #observeRecord(record: ProcessRecord): Promise<Observation> {
    if (!(record.startTime || record.tag)) {
      return { members: [], unobservable: true };
    }
    try {
      return await this.#observe(
        await this.#scope(record),
        record.tag ?? "",
        record.minimumStartTime ?? record.startTime
      );
    } catch {
      return { members: [], unobservable: true };
    }
  }

  async #signal(
    record: ProcessRecord,
    members: ProcStat[],
    signal: NodeJS.Signals
  ) {
    const signalled: number[] = [];
    await Promise.all(
      members.map(async (member) => {
        try {
          const current = await this.#table.stat(member.pid);
          if (current?.startTime !== member.startTime) {
            return;
          }
          const leaderPid = await this.#scope(record);
          const owned =
            (leaderPid > 0 &&
              (current.pgrp === leaderPid || current.session === leaderPid)) ||
            (record.tag !== "" &&
              (await this.#table.hasTag(member.pid, record.tag)));
          if (!owned) {
            return;
          }
          const latest = await this.#table.stat(member.pid);
          if (latest?.startTime !== member.startTime) {
            return;
          }
          // Do not signal a numeric process group after observation: its leader
          // may have been reused. Signal only individually verified identities.
          this.#table.signal(member.pid, signal);
          signalled.push(member.pid);
        } catch {
          // A later observation must confirm exit, including signal errors.
        }
      })
    );
    this.#options.onSignal?.(signal, signalled);
  }

  async #waitForExit(record: ProcessRecord, deadline: number) {
    return await pollUntil(
      () => this.#observeRecord(record),
      (value) => !value.unobservable && value.members.length === 0,
      deadline,
      POLL_MS
    );
  }

  async stopRecord(
    record: ProcessRecord,
    { graceMs = 1500, killMs = 2000 } = {}
  ): Promise<StopResult> {
    const current = this.#records.get(record.agentId);
    if (current?.pid === record.pid && current.tag === record.tag) {
      // Stop ends this launch's enrichment lifetime even if cleanup cannot
      // confirm exit. Keep ownership for retries, not permission to write later.
      this.#enriching.delete(current);
    }
    let observed = await this.#observeRecord(record);
    if (observed.members.length > 0) {
      await this.#signal(record, observed.members, "SIGTERM");
      observed = await this.#waitForExit(record, Date.now() + graceMs);
      if (observed.members.length > 0) {
        await this.#signal(record, observed.members, "SIGKILL");
        observed = await this.#waitForExit(record, Date.now() + killMs);
      }
    }
    return {
      stopped: !observed.unobservable && observed.members.length === 0,
      survivors: observed.members.map((stat) => stat.pid),
      ...(observed.unobservable ? { unobservable: true } : {}),
    };
  }

  async stop(agentId: string, options?: { graceMs?: number; killMs?: number }) {
    const record = this.#records.get(agentId);
    if (!record) {
      return { stopped: true, survivors: [] } satisfies StopResult;
    }
    const result = await this.stopRecord(record, options);
    if (result.stopped && this.#records.get(agentId) === record) {
      this.#records.delete(agentId);
      this.#tags.delete(agentId);
      this.#options.onRecord?.(null, agentId);
    }
    return result;
  }
}
