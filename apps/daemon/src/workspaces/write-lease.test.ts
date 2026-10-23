import { describe, expect, it, vi } from "vitest";

import { LeaseAbortedError, WriteLeaseRegistry } from "./write-lease";

describe(WriteLeaseRegistry, () => {
  it("grants one writer at a time in FIFO order", async () => {
    const leases = new WriteLeaseRegistry();
    const order: string[] = [];
    await leases.acquire("/w", "a");
    const b = leases.acquire("/w", "b").then(() => order.push("b"));
    const c = leases.acquire("/w", "c").then(() => order.push("c"));
    expect(leases.holder("/w")).toBe("a");
    leases.release("/w", "a");
    await b;
    expect(leases.holder("/w")).toBe("b");
    leases.release("/w", "b");
    await c;
    expect(order).toStrictEqual(["b", "c"]);
  });

  it("is re-entrant for the holder and independent per workspace", async () => {
    const leases = new WriteLeaseRegistry();
    await leases.acquire("/w", "a");
    await leases.acquire("/w", "a");
    await leases.acquire("/other", "b");
    expect(leases.holder("/other")).toBe("b");
  });

  it("cancels waits on abort and on forget", async () => {
    const leases = new WriteLeaseRegistry();
    await leases.acquire("/w", "a");
    const controller = new AbortController();
    const aborted = leases.acquire("/w", "b", controller.signal);
    controller.abort();
    await expect(aborted).rejects.toBeInstanceOf(LeaseAbortedError);
    const forgotten = leases.acquire("/w", "c");
    leases.forget("c");
    await expect(forgotten).rejects.toBeInstanceOf(LeaseAbortedError);
    leases.forget("a");
    expect(leases.holder("/w")).toBeNull();
  });

  it("does not grant an already-aborted free or reentrant acquisition", async () => {
    const changed = vi.fn<(workspace: string, holder: string | null) => void>();
    const leases = new WriteLeaseRegistry(changed);
    const controller = new AbortController();
    controller.abort();
    await expect(
      leases.acquire("/w", "a", controller.signal)
    ).rejects.toBeInstanceOf(LeaseAbortedError);
    expect([leases.holder("/w"), changed.mock.calls]).toStrictEqual([null, []]);
    await leases.acquire("/w", "a");
    await expect(
      leases.acquire("/w", "a", controller.signal)
    ).rejects.toBeInstanceOf(LeaseAbortedError);
    expect(changed).toHaveBeenCalledOnce();
  });

  it("removes abort listeners when waits are granted, forgotten or aborted", async () => {
    const leases = new WriteLeaseRegistry();
    await leases.acquire("/w", "a");
    const granted = new AbortController();
    const forgotten = new AbortController();
    const aborted = new AbortController();
    const grantCleanup = vi.spyOn(granted.signal, "removeEventListener");
    const forgetCleanup = vi.spyOn(forgotten.signal, "removeEventListener");
    const abortCleanup = vi.spyOn(aborted.signal, "removeEventListener");
    const b = leases.acquire("/w", "b", granted.signal);
    const c = leases.acquire("/w", "c", forgotten.signal);
    const d = leases.acquire("/w", "d", aborted.signal);
    const cancelled = Promise.allSettled([c, d]);
    leases.forget("c");
    aborted.abort();
    leases.release("/w", "a");
    await Promise.all([b, cancelled]);
    granted.abort();
    expect([
      grantCleanup.mock.calls.length,
      forgetCleanup.mock.calls.length,
      abortCleanup.mock.calls.length,
    ]).toStrictEqual([1, 1, 1]);
    expect(leases.holder("/w")).toBe("b");
    leases.release("/w", "b");
    await leases.acquire("/w", "fresh");
    expect([leases.holder("/w"), leases.waiting("/w")]).toStrictEqual([
      "fresh",
      [],
    ]);
  });
});
