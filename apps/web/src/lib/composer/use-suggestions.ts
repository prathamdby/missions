"use client";

import { useQuery } from "@tanstack/react-query";

import type { ComposerSuggestion } from "@/components/composer/composer-suggestions";
import { api } from "@/lib/api/endpoints";
import type { ComposerTrigger } from "@/lib/composer/trigger";

export interface ComposerScope {
  kind: "mission" | "project";
  id: string;
}

const useFiles = (
  scope: ComposerScope | null,
  query: string,
  enabled: boolean
) => {
  const search = useQuery({
    enabled,
    queryFn: ({ signal }) =>
      scope
        ? api.fileSearch(scope, query, signal)
        : Promise.resolve({ matches: [] }),
    queryKey: ["composer-files", scope?.kind, scope?.id, query],
    staleTime: 30_000,
  });
  return {
    items: (search.data?.matches ?? []).map((match) => ({ value: match.path })),
    loading: search.isFetching,
    unavailable: search.isError,
  };
};

const useCommands = (
  scope: ComposerScope | null,
  query: string,
  enabled: boolean
) => {
  const catalog = useQuery({
    enabled,
    queryFn: ({ signal }) =>
      scope
        ? api.composerCatalog(scope, signal)
        : Promise.resolve({ commands: [], source: "unavailable" as const }),
    queryKey: ["composer-catalog", scope?.kind, scope?.id],
    staleTime: 10 * 60_000,
  });
  const items: ComposerSuggestion[] = (catalog.data?.commands ?? [])
    .filter((command) =>
      command.name.toLowerCase().includes(query.toLowerCase())
    )
    .map((command) => ({
      description: [command.description, command.argumentHint]
        .filter(Boolean)
        .join(" · "),
      label: `/${command.name}`,
      value: command.name,
    }));
  return {
    items,
    loading: catalog.isFetching,
    unavailable: catalog.isError || catalog.data?.source === "unavailable",
  };
};

export const useComposerSuggestions = (
  scope: ComposerScope | null,
  trigger: ComposerTrigger | null,
  open: boolean
) => {
  const query = trigger?.query ?? "";
  const files = useFiles(scope, query, open && trigger?.kind === "file");
  const commands = useCommands(
    scope,
    query,
    open && trigger?.kind === "command"
  );
  return trigger?.kind === "command" ? commands : files;
};
