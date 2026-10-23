"use client";

import { useMemo, useRef } from "react";

import { newOperationId } from "@/lib/api/client";

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
      settle: () => {
        current.current = null;
      },
    }),
    []
  );
};
