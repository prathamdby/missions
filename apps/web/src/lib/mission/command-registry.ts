import type { QueryClient } from "@tanstack/react-query";

import {
  invalidateMissionResources,
  removeMission,
  upsertMissionSummary,
} from "../live/global-cache";
import type { LocalEntity } from "../live/mission-store";
import { missionCommandTransport } from "./command-transport";
import { MissionCommands } from "./commands";

/** Where command results go while a mission view is open. */
export interface MissionCommandSink {
  apply: (entity: LocalEntity) => void;
  refresh: () => Promise<boolean>;
}

interface Entry {
  commands: MissionCommands;
  sink: MissionCommandSink | null;
}

const registries = new WeakMap<QueryClient, Map<string, Entry>>();

const entryFor = (client: QueryClient, missionId: string): Entry => {
  let registry = registries.get(client);
  if (!registry) {
    registry = new Map();
    registries.set(client, registry);
  }
  const existing = registry.get(missionId);
  if (existing) {
    return existing;
  }
  const entry: Entry = {
    commands: new MissionCommands(
      missionId,
      missionCommandTransport(
        missionId,
        (entity) => {
          if (entry.sink) {
            entry.sink.apply(entity);
          } else if (entity.kind === "mission") {
            upsertMissionSummary(client, entity.value);
          }
        },
        () => {
          if (entry.sink) {
            return entry.sink.refresh();
          }
          invalidateMissionResources(client, missionId);
          return Promise.resolve(true);
        },
        () => removeMission(client, missionId)
      )
    ),
    sink: null,
  };
  registry.set(missionId, entry);
  return entry;
};

/**
 * One command admission per mission, shared by the sidebar menu and the
 * mission view, so their controls exclude each other and retries keep the
 * same operation id.
 */
export const missionCommandsFor = (client: QueryClient, missionId: string) =>
  entryFor(client, missionId).commands;

/** Routes results into the open mission's live state until detached. */
export const attachMissionSink = (
  client: QueryClient,
  missionId: string,
  sink: MissionCommandSink
) => {
  const entry = entryFor(client, missionId);
  entry.sink = sink;
  return () => {
    if (entry.sink === sink) {
      entry.sink = null;
    }
  };
};
