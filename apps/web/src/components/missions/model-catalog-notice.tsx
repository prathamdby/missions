"use client";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { errorMessage } from "@/lib/api/api-error";
import type { useModels } from "@/lib/api/queries";
import { catalogUnavailable } from "@/lib/mission/model-settings";

/** Loading line, or a retryable warning when Droid's model catalog is unusable. */
export const ModelCatalogNotice = ({
  catalog,
  unchanged,
}: {
  catalog: ReturnType<typeof useModels>;
  /** What stays as it was while the catalog is unavailable. */
  unchanged: string;
}) => {
  if (catalog.isPending) {
    return (
      <output className="text-xs leading-sm text-text-tertiary">
        Loading model catalog…
      </output>
    );
  }
  if (!catalogUnavailable(catalog)) {
    return null;
  }
  return (
    <Callout
      actions={
        <Button
          disabled={catalog.isFetching}
          onClick={() => catalog.refetch()}
          size="sm"
        >
          Retry model catalog
        </Button>
      }
      role="alert"
      title="Model catalog unavailable"
      tone="warning"
    >
      {catalog.isError
        ? errorMessage(catalog.error)
        : `No models are available from Droid. ${unchanged}`}
    </Callout>
  );
};
