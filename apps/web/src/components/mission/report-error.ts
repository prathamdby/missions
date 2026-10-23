"use client";

import { errorMessage, isStaleError } from "../../lib/api/api-error";
import { toast } from "../../lib/toast-store";

/**
 * Shared mutation failure handling: a stale revision or epoch means someone
 * else acted first, so reload instead of showing a raw conflict.
 */
export const reportMutationError = async (
  error: unknown,
  refresh: () => Promise<boolean>,
  title: string
) => {
  if (isStaleError(error)) {
    let refreshed: boolean;
    try {
      refreshed = await refresh();
    } catch {
      refreshed = false;
    }
    toast({
      description: refreshed
        ? "It changed before your action arrived. Showing the latest state."
        : "It changed before your action arrived. Reconnect to load the latest state before retrying.",
      title: "Already updated",
      tone: "info",
    });
    return;
  }
  toast({ description: errorMessage(error), title, tone: "danger" });
};
