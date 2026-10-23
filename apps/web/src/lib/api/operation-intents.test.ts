import { describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "./api-error";
import {
  createSingleFlight,
  isDefiniteFailure,
  OperationIntents,
  operationIntentKey,
} from "./operation-intents";

const failure = (status: number) =>
  new ApiRequestError({ code: "internal", message: "test", status });
const registry = () => {
  let next = 0;
  return new OperationIntents(() => {
    next += 1;
    return `operation-${next}`;
  });
};

describe(OperationIntents, () => {
  it.each([0, 200, 201, 204, 302, 500, 503])(
    "retains unknown outcome IDs for HTTP %s",
    (status) => {
      const intents = registry();
      const id = intents.idFor("a");
      intents.release(failure(status), "a");
      expect(intents.idFor("a")).toBe(id);
      expect(isDefiniteFailure(failure(status))).toBeFalsy();
    }
  );

  it.each([400, 401, 404, 409, 429, 499])(
    "releases only actual client rejections (%s)",
    (status) => {
      const intents = registry();
      const id = intents.idFor("a");
      intents.release(failure(status), "a");
      expect(intents.idFor("a")).not.toBe(id);
    }
  );

  it("does not let independent settlements/rejections erase another intent", () => {
    const intents = registry();
    const a = intents.idFor("a");
    const b = intents.idFor("b");
    intents.settle("a");
    expect(intents.idFor("b")).toBe(b);
    expect(intents.idFor("a")).not.toBe(a);
    intents.release(failure(409), "a");
    expect(intents.idFor("b")).toBe(b);
  });

  it("retains network/foreign errors and keeps the no-key compatibility target narrow", () => {
    const intents = registry();
    const a = intents.idFor("a");
    const b = intents.idFor("b");
    intents.release(new Error("network"), "a");
    intents.settle();
    expect(intents.idFor("a")).toBe(a);
    expect(intents.idFor("b")).not.toBe(b);
  });

  it("canonicalizes complete payloads but preserves meaningful ordering and fields", () => {
    expect(operationIntentKey({ message: "x", revision: 1 })).toBe(
      operationIntentKey(
        Object.fromEntries([
          ["revision", 1],
          ["message", "x"],
        ])
      )
    );
    expect(operationIntentKey({ revision: 1 })).not.toBe(
      operationIntentKey({ revision: 2 })
    );
    expect(operationIntentKey(["a", "b"])).not.toBe(
      operationIntentKey(["b", "a"])
    );
  });
});

describe(createSingleFlight, () => {
  it("guards mutate and mutateAsync synchronously across both entry points", async () => {
    const flight = createSingleFlight();
    const mutate = vi.fn<() => void>();
    flight.mutate(mutate);
    flight.mutate(mutate);
    await expect(
      flight.mutateAsync(() => Promise.resolve("duplicate"))
    ).rejects.toThrow("already in flight");
    expect(mutate).toHaveBeenCalledOnce();
    flight.leave();
    await expect(
      flight.mutateAsync(() => Promise.resolve("next"))
    ).resolves.toBe("next");
  });

  it("ignores mutate during mutateAsync, then releases on success and failure", async () => {
    const flight = createSingleFlight();
    const pending = Promise.withResolvers<string>();
    const mutate = vi.fn<() => void>();
    const request = flight.mutateAsync(() => pending.promise);
    flight.mutate(mutate);
    expect(mutate).not.toHaveBeenCalled();
    pending.resolve("done");
    await request;
    await expect(
      flight.mutateAsync(() => Promise.reject(new Error("failed")))
    ).rejects.toThrow("failed");
    await expect(
      flight.mutateAsync(() => Promise.resolve("retry"))
    ).resolves.toBe("retry");
  });

  it("never lets an older async finalizer unlock a newly admitted mutation", async () => {
    const flight = createSingleFlight();
    const pending = Promise.withResolvers<string>();
    const first = flight.mutateAsync(() => pending.promise);
    flight.leave();
    flight.mutate(() => {});
    pending.resolve("done");
    await first;
    await expect(
      flight.mutateAsync(() => Promise.resolve("overlap"))
    ).rejects.toThrow("already in flight");
  });

  it("releases when a synchronous mutation admission throws", async () => {
    const flight = createSingleFlight();
    expect(() =>
      flight.mutate(() => {
        throw new Error("failed");
      })
    ).toThrow("failed");
    await expect(
      flight.mutateAsync(() => Promise.resolve("retry"))
    ).resolves.toBe("retry");
  });
});
