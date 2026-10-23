import { readFileSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export interface ProcStat {
  pid: number;
  pgrp: number;
  session: number;
  startTime: string;
  state: string;
}

/** Missing processes return null; unreadable observations throw. */
export interface ProcessTable {
  /** Earliest possible launch tick, captured from the supervising process. */
  readonly launchFloor?: string;
  pids: () => Promise<number[]>;
  stat: (pid: number) => Promise<ProcStat | null>;
  hasTag: (pid: number, tag: string) => Promise<boolean>;
  signal: (pid: number, signal: NodeJS.Signals) => void;
}

export const TAG_VARIABLE = "MISSIONS_AGENT_TAG";
const STAT_PATTERN = /^(?<pid>\d+) \(.*\) (?<rest>.*)$/su;
const PID_PATTERN = /^\d+$/u;

export const parseProcStat = (raw: string): ProcStat | null => {
  const match = STAT_PATTERN.exec(raw.trim());
  if (!match?.groups) {
    return null;
  }
  const fields = (match.groups.rest ?? "").split(" ");
  const [state, , pgrp, session] = fields;
  const { 19: startTime } = fields;
  if (!(state && pgrp && session && startTime)) {
    return null;
  }
  const result = {
    pgrp: Number(pgrp),
    pid: Number(match.groups.pid),
    session: Number(session),
    startTime,
    state,
  };
  return Number.isSafeInteger(result.pid) &&
    Number.isSafeInteger(result.pgrp) &&
    Number.isSafeInteger(result.session) &&
    PID_PATTERN.test(startTime)
    ? result
    : null;
};

const absent = (error: unknown) =>
  error instanceof Error &&
  "code" in error &&
  (error.code === "ENOENT" || error.code === "ESRCH");

/** Linux adapter. Tagged descendants are supervised within the launch UID. */
export class LinuxProcessTable implements ProcessTable {
  readonly #root: string;
  readonly launchFloor: string | undefined;

  constructor(root = "/proc") {
    this.#root = root;
    try {
      this.launchFloor = parseProcStat(
        readFileSync(path.join(root, String(process.pid), "stat"), "utf-8")
      )?.startTime;
    } catch {
      // Without a floor, all potentially tagged processes must be observed.
    }
  }

  async pids() {
    const names = await readdir(this.#root);
    return names.filter((name) => PID_PATTERN.test(name)).map(Number);
  }

  async stat(pid: number): Promise<ProcStat | null> {
    try {
      const value = parseProcStat(
        await readFile(path.join(this.#root, String(pid), "stat"), "utf-8")
      );
      if (!value || value.pid !== pid) {
        throw new Error(`Invalid process stat for ${pid}`);
      }
      return value;
    } catch (error) {
      if (absent(error)) {
        return null;
      }
      throw error;
    }
  }

  async hasTag(pid: number, tag: string) {
    try {
      const directory = path.join(this.#root, String(pid));
      // Other users' environ is normally unreadable and cannot belong to this
      // launch. Changing UID, like scrubbing the tag, escapes tag supervision.
      const owner = await stat(directory);
      if (process.getuid && owner.uid !== process.getuid()) {
        return false;
      }
      const environ = await readFile(path.join(directory, "environ"), "utf-8");
      return environ.split("\0").includes(`${TAG_VARIABLE}=${tag}`);
    } catch (error) {
      if (absent(error)) {
        return false;
      }
      throw error;
    }
  }

  readonly signal: ProcessTable["signal"] = process.kill.bind(process);
}
