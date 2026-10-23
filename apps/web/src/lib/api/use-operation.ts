"use client";

import { useMemo, useRef } from "react";

import { isApiError } from "@/lib/api/api-error";
import { newOperationId } from "@/lib/api/client";

const SERVER_ERROR = 500;

/**
 * True when the daemon definitely did not act: it answered with a 4xx. A
 * network failure or 5xx may hide an effect that happened, so the intent
 * must keep its ID and let the daemon reconcile on retry.
 */
export const isDefiniteFailure = (error: unknown) =>
  isApiError(error) && error.status > 0 && error.status < SERVER_ERROR;

/**
 * Operation IDs keyed by request intent. Retrying the same intent after a
 * failure reuses its ID so the daemon can deduplicate; `settle` forgets it so
 * a later identical request counts as new.
 */
export const useOperationIds = () => {
  const current = useRef<{ id: string; key: string } | null>(null);
  return useMemo(
    () => ({
      idFor: (key: string) => {
        if (current.current?.key !== key) {
          current.current = { id: newOperationId(), key };
        }
        return current.current.id;
      },
      /** After an error: a definite rejection is recorded as failed by the daemon, so the next attempt needs a new ID. */
      release: (error: unknown) => {
        if (isDefiniteFailure(error)) {
          current.current = null;
        }
      },
      settle: () => {
        current.current = null;
      },
    }),
    []
  );
};
