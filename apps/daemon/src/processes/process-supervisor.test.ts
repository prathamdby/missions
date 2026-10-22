import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { sleep } from "../lib/async";
import { parseProcStat, ProcessSupervisor } from "./process-supervisor";

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
    await expect(
      supervisor.members(record?.pid ?? -1, record?.tag)
    ).resolves.toHaveLength(0);
  });
});
