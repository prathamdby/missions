"use client";

import { errorMessage, isStaleError } from "@/lib/api/api-error";
import { toast } from "@/lib/toast-store";

/**
 * Shared mutation failure handling: a stale revision or epoch means someone
 * else acted first, so reload instead of showing a raw conflict.
 */
export const reportMutationError = (
  error: unknown,
  refresh: () => Promise<boolean>,
  title: string
) => {
  if (isStaleError(error)) {
    refresh();
    toast({
      description:
        "It changed before your action arrived. Showing the latest state.",
      title: "Already updated",
      tone: "info",
    });
    return;
  }
  toast({ description: errorMessage(error), title, tone: "danger" });
};
