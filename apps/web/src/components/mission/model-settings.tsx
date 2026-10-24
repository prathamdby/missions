"use client";

import type { AgentModelSettings } from "@missions/protocol/missions";
import type { ModelOption } from "@missions/protocol/settings";
import { useSyncExternalStore } from "react";

import { useMission } from "@/components/mission/mission-context";
import { PanelSection } from "@/components/mission/panel-kit";
import { useMissionCommand } from "@/components/mission/use-mission-command";
import { ModelCatalogNotice } from "@/components/missions/model-catalog-notice";
import { ModelControls } from "@/components/missions/model-controls";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { errorMessage, isStaleError } from "@/lib/api/api-error";
import { useModels } from "@/lib/api/queries";
import {
  catalogUnavailable,
  modelSettingsSupported,
  modelSettingsUpdate,
} from "@/lib/mission/model-settings";
import type { ModelRole } from "@/lib/mission/model-settings";

const SCOPE = {
  orchestrator:
    "Only this mission. Applies to the Orchestrator's next turn without interrupting its current work.",
  worker:
    "Only this mission. Applies to future Workers; existing Workers keep their current settings.",
} as const;

const ModelRow = ({
  agentRole,
  models,
  unavailable,
}: {
  agentRole: ModelRole;
  models: readonly ModelOption[];
  unavailable: boolean;
}) => {
  const { commands, live } = useMission();
  const { mission } = live;
  const settings = mission[agentRole];
  const label = agentRole === "orchestrator" ? "Orchestrator" : "Workers";
  // Both controls share synchronous admission, including before React renders
  // pending. Returned missions already use the session's revision-aware path.
  const update = useMissionCommand(
    "update",
    `Could not change ${label} settings`
  );
  const pendingRole = useSyncExternalStore(
    commands.subscribe,
    () => commands.pendingModelUpdate(agentRole),
    () => false
  );
  const pending = pendingRole || update.isPending;
  const change = (next: AgentModelSettings) =>
    update.mutate(modelSettingsUpdate(agentRole, next, mission.revision));
  const failedSettings = update.variables?.[agentRole];
  const retryable =
    failedSettings !== undefined &&
    modelSettingsSupported(failedSettings, models) &&
    !unavailable &&
    !isStaleError(update.error);

  return (
    <>
      <ModelControls
        label={label}
        models={models}
        onChange={change}
        pending={pending}
        scope={SCOPE[agentRole]}
        settings={settings}
        testId={`${agentRole}-model-row`}
        unavailable={unavailable}
      />
      <output className="sr-only">
        {pending ? `Saving ${label} settings…` : ""}
      </output>
      {update.isError ? (
        <Callout
          actions={
            retryable ? (
              <Button
                onClick={() => {
                  if (failedSettings) {
                    change(failedSettings);
                  }
                }}
                size="sm"
              >
                Retry {label} settings
              </Button>
            ) : undefined
          }
          onDismiss={() => update.reset()}
          role="alert"
          title={`Could not change ${label} settings`}
          tone="danger"
        >
          {isStaleError(update.error)
            ? "The mission changed. Review the latest choices before trying again."
            : errorMessage(update.error)}
        </Callout>
      ) : null}
    </>
  );
};

export const Models = () => {
  const catalog = useModels();
  const models = catalog.data?.models ?? [];
  const unavailable = catalogUnavailable(catalog);
  return (
    <PanelSection gap="xs" grow title="Models">
      <ModelRow
        agentRole="orchestrator"
        models={models}
        unavailable={unavailable}
      />
      <ModelRow agentRole="worker" models={models} unavailable={unavailable} />
      <ModelCatalogNotice
        catalog={catalog}
        unchanged="Existing mission settings are unchanged."
      />
    </PanelSection>
  );
};
