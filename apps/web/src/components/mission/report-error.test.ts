import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "../../lib/api/api-error";
import { dismissToast, getToasts } from "../../lib/toast-store";
import { reportMutationError } from "./report-error";

describe(reportMutationError, () => {
  afterEach(() => {
    for (const notice of getToasts()) {
      dismissToast(notice.id);
    }
  });

  it("waits for stale revision recovery before promising the latest state", async () => {
    const pending = Promise.withResolvers<boolean>();
    const refresh = vi
      .fn<() => Promise<boolean>>()
      .mockReturnValue(pending.promise);
    const error = new ApiRequestError({
      code: "stale_revision",
      message: "Moved",
      status: 409,
    });
    const recovery = reportMutationError(error, refresh, "Could not update");
    expect(getToasts()).toStrictEqual([]);
    pending.resolve(true);
    await recovery;
    expect(refresh).toHaveBeenCalledOnce();
    expect(getToasts()[0]).toMatchObject({
      description:
        "It changed before your action arrived. Showing the latest state.",
      title: "Already updated",
      tone: "info",
    });
  });

  it.each([false, "throw"])(
    "does not claim stale recovery succeeded when refresh returns %s",
    async (outcome) => {
      const refresh =
        outcome === false
          ? () => Promise.resolve(false)
          : () => Promise.reject(new Error("offline"));
      const error = new ApiRequestError({
        code: "stale_revision",
        message: "Moved",
        status: 409,
      });
      await reportMutationError(error, refresh, "Could not update");
      expect(getToasts()[0]?.description).toContain("Reconnect");
    }
  );

  it("reports actionable conflicts without replacing them with stale recovery", async () => {
    const refresh = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const error = new ApiRequestError({
      code: "conflict",
      message: "Push rejected",
      status: 409,
    });
    await reportMutationError(error, refresh, "Could not push");
    expect(refresh).not.toHaveBeenCalled();
    expect(getToasts()[0]).toMatchObject({
      description: "Push rejected",
      title: "Could not push",
      tone: "danger",
    });
  });
});
