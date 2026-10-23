import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { run } from "./exec";

describe(run, () => {
  it("cancels and drains an owned process group including SIGTERM-resistant children", async () => {
    const ready = Promise.withResolvers<undefined>();
    const controller = new AbortController();
    const pids: number[] = [];
    const executing = run(
      process.execPath,
      [
        "-e",
        `
    const { spawn } = require("node:child_process");
    process.on("SIGTERM", () => {});
    const child = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: "inherit" });
    process.stderr.write(JSON.stringify([process.pid, child.pid]) + "\\n");
    setInterval(() => {}, 1000);
  `,
      ],
      {
        onStderrLine: (line) => {
          pids.push(...(JSON.parse(line) as number[]));
          ready.resolve(undefined);
        },
        signal: controller.signal,
        timeoutMs: 10_000,
      }
    );
    await ready.promise;
    controller.abort();
    const result = await executing;
    expect(result.ok).toBeFalsy();
    await vi.waitFor(async () => {
      const states = await Promise.all(
        pids.map(async (pid) => {
          const info = await readFile(`/proc/${pid}/stat`, "utf-8").catch(
            () => null
          );
          return (
            info === null ||
            info.slice(info.lastIndexOf(")") + 2).startsWith("Z")
          );
        })
      );
      expect(states).toStrictEqual([true, true]);
    });
  });

  it("accepts byte input without a shell or text round trip", async () => {
    const result = await run(
      process.execPath,
      [
        "-e",
        `
    process.stdin.on("data", (data) => process.stdout.write(data.toString("hex")));
  `,
      ],
      { input: Buffer.from([0, 255, 128, 10]) }
    );
    expect(result).toMatchObject({ ok: true, stdout: "00ff800a" });
  });
});
