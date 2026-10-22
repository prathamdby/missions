import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { pollUntil } from "../lib/async";

/**
 * `ProcessTransport.close()` signals only the direct child, so tool commands
 * the agent backgrounded would survive. Every SDK child is launched through a
 * `setsid` shim so the whole process group (and session) can be stopped and
 * the stop confirmed through /proc. Droid detaches fire-and-forget commands
 * into their own session, so each launch also carries an inherited
 * environment tag that /proc scanning matches. A process that scrubs its
 * environment and calls setsid escapes both checks.
 */

export interface ProcessRecord {
  agentId: string;
  pid: number;
  /** Kernel start time in clock ticks; guards against PID reuse. */
  startTime: string;
  /** Inherited environment marker for detached descendants. */
  tag: string;
}

export interface StopResult {
  stopped: boolean;
  survivors: number[];
}

export interface ProcessSupervisorOptions {
  binDir: string;
  droidPath: string;
  procRoot?: string;
  onRecord?: (record: ProcessRecord | null, agentId: string) => void;
  onSignal?: (signal: NodeJS.Signals, pids: number[]) => void;
}

interface ProcStat {
  pid: number;
  pgrp: number;
  session: number;
  startTime: string;
  state: string;
}

export const TAG_VARIABLE = "MISSIONS_AGENT_TAG";
const STAT_PATTERN = /^(?<pid>\d+) \(.*\) (?<rest>.*)$/su;
const POLL_MS = 50;

export const parseProcStat = (raw: string): ProcStat | null => {
  const match = STAT_PATTERN.exec(raw.trim());
  if (!match?.groups) {
    return null;
  }
  const fields = (match.groups.rest ?? "").split(" ");
  // Fields after "(comm)": state=0, ppid=1, pgrp=2, session=3, ..., starttime=19.
  const [state, , pgrp, session] = fields;
  const { 19: startTime } = fields;
  if (!(state && pgrp && session && startTime)) {
    return null;
  }
  return {
    pgrp: Number(pgrp),
    pid: Number(match.groups.pid),
    session: Number(session),
    startTime,
    state,
  };
};

export class ProcessSupervisor {
  readonly #options: ProcessSupervisorOptions;
  readonly #procRoot: string;
  readonly #records = new Map<string, ProcessRecord>();
  readonly #tags = new Map<string, string>();
  #launcherPath: string | null = null;

  constructor(options: ProcessSupervisorOptions) {
    this.#options = options;
    this.#procRoot = options.procRoot ?? "/proc";
  }

  /** Writes the setsid shim used as the SDK `droidExecPath`. */
  async ensureLauncher(): Promise<string> {
    if (this.#launcherPath) {
      return this.#launcherPath;
    }
    await mkdir(this.#options.binDir, { recursive: true });
    const launcher = path.join(this.#options.binDir, "droid-session-leader.sh");
    // exec keeps the PID: the SDK's child becomes the session/group leader.
    const script = `#!/bin/sh\nexec setsid "$MISSIONS_DROID_BIN" "$@"\n`;
    await writeFile(launcher, script, { mode: 0o755 });
    await chmod(launcher, 0o755);
    this.#launcherPath = launcher;
    return launcher;
  }

  /** Environment for one agent launch; the tag marks every descendant. */
  launchEnv(agentId: string): Record<string, string> {
    const tag = `${agentId}.${randomUUID()}`;
    this.#tags.set(agentId, tag);
    return { MISSIONS_DROID_BIN: this.#options.droidPath, [TAG_VARIABLE]: tag };
  }

  /** Called from `ProcessTransport`'s `onSpawned` hook. */
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
    };
    this.#records.set(agentId, record);
    void this.#captureStartTime(agentId, record);
  }

  async #captureStartTime(agentId: string, record: ProcessRecord) {
    const stat = await this.#readStat(record.pid);
    if (stat && this.#records.get(agentId) === record) {
      record.startTime = stat.startTime;
      this.#options.onRecord?.(record, agentId);
    }
  }

  record(agentId: string) {
    return this.#records.get(agentId) ?? null;
  }

  async #readStat(pid: number): Promise<ProcStat | null> {
    try {
      return parseProcStat(
        await readFile(path.join(this.#procRoot, String(pid), "stat"), "utf-8")
      );
    } catch {
      return null;
    }
  }

  async #hasTag(pid: number, tag: string) {
    try {
      const environ = await readFile(
        path.join(this.#procRoot, String(pid), "environ"),
        "utf-8"
      );
      return environ.split("\0").includes(`${TAG_VARIABLE}=${tag}`);
    } catch {
      return false;
    }
  }

  /** Every live process in the leader's group or session, or carrying its tag. */
  async members(leaderPid: number, tag = ""): Promise<number[]> {
    let names: string[];
    try {
      names = await readdir(this.#procRoot);
    } catch {
      return [];
    }
    const pids = names.filter((name) => /^\d+$/u.test(name)).map(Number);
    const stats = await Promise.all(pids.map((pid) => this.#readStat(pid)));
    const live = stats.filter(
      (stat): stat is ProcStat => stat !== null && stat.state !== "Z"
    );
    const tagged = await Promise.all(
      live.map(async (stat) => {
        if (stat.pgrp === leaderPid || stat.session === leaderPid) {
          return stat.pid;
        }
        return tag !== "" && (await this.#hasTag(stat.pid, tag))
          ? stat.pid
          : null;
      })
    );
    return tagged.filter((pid): pid is number => pid !== null);
  }

  #signal(pids: number[], leaderPid: number, signal: NodeJS.Signals) {
    this.#options.onSignal?.(signal, pids);
    if (leaderPid > 0) {
      try {
        process.kill(-leaderPid, signal);
      } catch {
        // The group may already be gone; members are signalled below.
      }
    }
    for (const pid of pids) {
      try {
        process.kill(pid, signal);
      } catch {
        // Already exited.
      }
    }
  }

  async #waitForExit(record: ProcessRecord, deadline: number) {
    return await pollUntil(
      () => this.members(record.pid, record.tag),
      (members) => members.length === 0,
      deadline,
      POLL_MS
    );
  }

  /** Stops a recorded group and confirms nothing in it survives. */
  async stopRecord(
    record: ProcessRecord,
    { graceMs = 1500, killMs = 2000 } = {}
  ): Promise<StopResult> {
    const leader = await this.#readStat(record.pid);
    const reused =
      leader !== null &&
      record.startTime !== "" &&
      leader.startTime !== record.startTime;
    // A reused leader PID belongs to an unrelated process: match by tag only.
    const scoped: ProcessRecord = reused ? { ...record, pid: -1 } : record;
    let members = await this.members(scoped.pid, scoped.tag);
    if (members.length === 0) {
      return { stopped: true, survivors: [] };
    }
    this.#signal(members, scoped.pid, "SIGTERM");
    members = await this.#waitForExit(scoped, Date.now() + graceMs);
    if (members.length > 0) {
      this.#signal(members, scoped.pid, "SIGKILL");
      members = await this.#waitForExit(scoped, Date.now() + killMs);
    }
    return { stopped: members.length === 0, survivors: members };
  }

  async stop(agentId: string, options?: { graceMs?: number; killMs?: number }) {
    const record = this.#records.get(agentId);
    if (!record) {
      return { stopped: true, survivors: [] } satisfies StopResult;
    }
    const result = await this.stopRecord(record, options);
    if (result.stopped) {
      this.#records.delete(agentId);
      this.#options.onRecord?.(null, agentId);
    }
    return result;
  }
}
