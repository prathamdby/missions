import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { DroidClient, ProcessTransport } from "@factory/droid-sdk/node";

import { ProcessSupervisor } from "../processes/process-supervisor";
import { MODEL_PROBE_TIMEOUT_MS, withDeadline } from "./startup";

type Initialized = Awaited<ReturnType<DroidClient["initializeSession"]>>;
type Cleanup = () => Promise<void>;

/** Supervised, bounded throwaway sessions shared by SDK discovery adapters. */
export class ProbeSessions {
  readonly #droidPath: string;
  readonly #active = new Set<Cleanup>();
  readonly #cancel = new AbortController();

  constructor(droidPath: string) {
    this.#droidPath = droidPath;
  }

  async run<T>(
    cwd: string,
    use: (client: DroidClient, initialized: Initialized) => Promise<T> | T
  ): Promise<T> {
    if (this.#cancel.signal.aborted) {
      throw new Error("SDK discovery is closed");
    }
    const agentId = `sdk-probe-${randomUUID()}`;
    const supervisor = new ProcessSupervisor({
      binDir: path.join(os.tmpdir(), `missions-${agentId}`),
      droidPath: this.#droidPath,
    });
    let client: DroidClient | null = null;
    let closing = false;
    const dispose = async () => {
      closing = true;
      const cooperative = client
        ? withDeadline(
            client.close(),
            1000,
            "SDK probe cleanup timed out"
          ).catch(() => null)
        : Promise.resolve();
      try {
        const result = await supervisor.stop(agentId);
        if (!result.stopped) {
          throw new Error("SDK discovery process could not be stopped");
        }
      } finally {
        await cooperative;
      }
    };
    const deadline = <R>(operation: Promise<R>) =>
      withDeadline(
        operation,
        MODEL_PROBE_TIMEOUT_MS,
        "SDK discovery timed out",
        this.#cancel.signal
      );
    this.#active.add(dispose);
    try {
      const launcher = await deadline(supervisor.ensureLauncher());
      if (closing || this.#cancel.signal.aborted) {
        throw new Error("SDK discovery was cancelled");
      }
      const transport = new ProcessTransport({
        cwd,
        droidExecPath: launcher,
        env: supervisor.launchEnv(agentId),
        onSpawned: (child) => supervisor.register(agentId, child),
      });
      client = new DroidClient({
        sessionInitTimeout: MODEL_PROBE_TIMEOUT_MS,
        transport,
      });
      await deadline(
        transport.connect().finally(async () => {
          if (closing) {
            await dispose();
          }
        })
      );
      const initialized = await deadline(
        client.initializeSession({ cwd, machineId: "default", worktree: false })
      );
      return await deadline(Promise.resolve(use(client, initialized)));
    } finally {
      await dispose();
      this.#active.delete(dispose);
    }
  }

  async close(): Promise<void> {
    this.#cancel.abort();
    const results = await Promise.allSettled(
      [...this.#active].map((dispose) => dispose())
    );
    const errors = results
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason as unknown);
    if (errors.length > 0) {
      throw new AggregateError(errors, "SDK discovery cleanup failed");
    }
  }
}
