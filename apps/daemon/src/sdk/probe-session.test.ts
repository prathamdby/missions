import { stat } from "node:fs/promises";
import path from "node:path";

import { ReasoningEffort } from "@factory/droid-sdk";
import { DroidClient, ProcessTransport } from "@factory/droid-sdk/node";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProcessSupervisor } from "../processes/process-supervisor";
import { ProbeSessions } from "./probe-session";
import { MODEL_PROBE_TIMEOUT_MS } from "./startup";

const capture = async <T>(promise: Promise<T>) => {
  try {
    return { value: await promise };
  } catch (error) {
    return { error };
  }
};

const setup = () => {
  const close = vi.spyOn(DroidClient.prototype, "close").mockResolvedValue();
  const connect = vi
    .spyOn(ProcessTransport.prototype, "connect")
    .mockResolvedValue();
  const initialize = vi
    .spyOn(DroidClient.prototype, "initializeSession")
    .mockResolvedValue({
      factoryApiVersion: "1.0.0",
      id: "initialize",
      jsonrpc: "2.0",
      result: {
        availableModels: [],
        session: { messages: [] },
        sessionId: "probe",
        settings: { modelId: "model", reasoningEffort: ReasoningEffort.Medium },
      },
      type: "response",
    });
  const launcher = vi.spyOn(ProcessSupervisor.prototype, "ensureLauncher");
  const stop = vi.spyOn(ProcessSupervisor.prototype, "stop").mockResolvedValue({
    stopped: true,
    survivors: [],
  });
  const probes = new ProbeSessions("unused");
  const directory = async () => {
    const value = await launcher.mock.results[0]?.value;
    if (!value) {
      throw new Error("Missing probe launcher");
    }
    return path.dirname(value);
  };
  return { close, connect, directory, initialize, launcher, probes, stop };
};

describe("probe launcher lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each([false, true])(
    "removes launcher files after completion (failure=%s)",
    async (failure) => {
      const { close, directory, initialize, probes } = setup();
      if (failure) {
        initialize.mockRejectedValueOnce(new Error("initialization failed"));
      }
      const result = await probes
        .run("/workspace", () => "catalog")
        .catch((error: unknown) =>
          error instanceof Error ? error.message : error
        );
      expect(result).toBe(failure ? "initialization failed" : "catalog");
      await expect(stat(await directory())).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(close).toHaveBeenCalledWith();
      await probes.close();
    }
  );

  it("cleans up again when a connection finishes after its deadline", async () => {
    vi.useFakeTimers();
    const connection = Promise.withResolvers<undefined>();
    const { connect, directory, probes, stop } = setup();
    connect.mockReturnValueOnce(connection.promise);
    const pending = capture(probes.run("/workspace", () => "catalog"));
    await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(MODEL_PROBE_TIMEOUT_MS);
    await expect(pending).resolves.toMatchObject({
      error: { message: "SDK discovery timed out" },
    });
    connection.resolve(undefined);
    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(2));
    await expect(stat(await directory())).rejects.toMatchObject({
      code: "ENOENT",
    });
    await probes.close();
  });

  it("removes a launcher that is created after cancellation", async () => {
    const original = ProcessSupervisor.prototype.ensureLauncher;
    const barrier = Promise.withResolvers<undefined>();
    const { connect, directory, launcher, probes } = setup();
    launcher.mockImplementation(async function delayedLauncher(
      this: ProcessSupervisor
    ) {
      await barrier.promise;
      return await original.call(this);
    });
    const pending = capture(probes.run("/workspace", () => "catalog"));
    await probes.close();
    await expect(pending).resolves.toMatchObject({
      error: { message: expect.stringMatching(/cancel/u) },
    });
    barrier.resolve(undefined);
    const dir = await directory();
    await vi.waitFor(async () => {
      await expect(stat(dir)).rejects.toMatchObject({ code: "ENOENT" });
    });
    expect(connect).not.toHaveBeenCalled();
  });
});
