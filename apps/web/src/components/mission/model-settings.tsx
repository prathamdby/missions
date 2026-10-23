"use client";

import type { AgentModelSettings } from "@missions/protocol/missions";
import type { ModelOption } from "@missions/protocol/settings";
import { useId, useState, useSyncExternalStore } from "react";

import { useMission } from "@/components/mission/mission-context";
import { PanelSection } from "@/components/mission/panel-kit";
import { useMissionCommand } from "@/components/mission/use-mission-command";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Hint } from "@/components/ui/tooltip";
import { errorMessage, isStaleError } from "@/lib/api/api-error";
import { useModels } from "@/lib/api/queries";
import {
  modelSettingsSupported,
  modelSettingsUpdate,
  settingsForModel,
} from "@/lib/mission/model-settings";
import type { ModelRole } from "@/lib/mission/model-settings";
import { effortLabel } from "@/lib/mission/pr";

const DEFAULT_EFFORT = "model-default";

/** Keep a saving trigger focusable for Radix's close autofocus, but inert. */
const useSavingSelect = (pending: boolean) => {
  const [open, setOpen] = useState(false);
  const handleOpenChange = (next: boolean) => {
    if (!next || !pending) {
      setOpen(next);
    }
  };
  return { handleOpenChange, open };
};
const SCOPE = {
  orchestrator:
    "Only this mission. Applies to the Orchestrator's next turn without interrupting its current work.",
  worker:
    "Only this mission. Applies to future Workers; existing Workers keep their current settings.",
} as const;

const selectionDescription = (
  agentRole: ModelRole,
  model: ModelOption | undefined,
  settings: AgentModelSettings,
  unavailable: boolean
) => {
  const notes: string[] = [SCOPE[agentRole]];
  if (model?.supportedReasoningEfforts.length === 0) {
    notes.push("This model does not expose thinking levels.");
  } else if (
    model &&
    settings.reasoningEffort !== null &&
    !model.supportedReasoningEfforts.includes(settings.reasoningEffort)
  ) {
    notes.push(
      "The current thinking level is not in the live catalog. Choose a supported level."
    );
  }
  if (!model && !unavailable) {
    notes.push("The current model is not in the live catalog.");
  }
  return notes.join(" ");
};

const ThinkingPicker = ({
  description,
  descriptionId,
  disabled,
  label,
  model,
  pending,
  onValueChange,
  settings,
}: {
  description: string;
  descriptionId: string;
  disabled: boolean;
  label: string;
  model: ModelOption | undefined;
  pending: boolean;
  onValueChange: (value: string) => void;
  settings: AgentModelSettings;
}) => {
  const efforts = model?.supportedReasoningEfforts ?? [];
  const noEfforts = model !== undefined && efforts.length === 0;
  const { handleOpenChange, open } = useSavingSelect(pending);
  const thinking = noEfforts ? "N/A" : effortLabel(settings.reasoningEffort);
  const effortUnavailable =
    settings.reasoningEffort !== null &&
    !efforts.includes(settings.reasoningEffort);
  return (
    <Select
      disabled={disabled || !model || noEfforts}
      onValueChange={onValueChange}
      onOpenChange={handleOpenChange}
      open={open}
      value={settings.reasoningEffort ?? DEFAULT_EFFORT}
    >
      <Hint disabled={open || pending} label={description}>
        <SelectTrigger
          appearance="thinking"
          aria-describedby={descriptionId}
          aria-label={`${label} thinking`}
          aria-disabled={disabled || !model || noEfforts || pending}
        >
          <span>Thinking</span>
          <SelectValue>{thinking}</SelectValue>
        </SelectTrigger>
      </Hint>
      <SelectContent
        appearance="thinking"
        aria-label={`${label} thinking levels`}
      >
        {settings.reasoningEffort === null ? (
          <SelectItem appearance="thinking" disabled value={DEFAULT_EFFORT}>
            Default
          </SelectItem>
        ) : null}
        {effortUnavailable ? (
          <SelectItem
            appearance="thinking"
            disabled
            value={settings.reasoningEffort ?? DEFAULT_EFFORT}
          >
            {thinking} (unavailable)
          </SelectItem>
        ) : null}
        {efforts.map((effort) => (
          <SelectItem appearance="thinking" key={effort} value={effort}>
            {effortLabel(effort)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

/** GCL closed controls; KXE model menu; J48/J4O thinking menu. */
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
  const descriptionId = useId();
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
  const { handleOpenChange, open } = useSavingSelect(pending);
  const model = models.find((option) => option.id === settings.modelId);
  const name = model?.displayName ?? settings.modelId;
  const efforts = model?.supportedReasoningEfforts ?? [];
  const description = selectionDescription(
    agentRole,
    model,
    settings,
    unavailable
  );
  const change = (next: AgentModelSettings) =>
    update.mutate(modelSettingsUpdate(agentRole, next, mission.revision));
  const changeModel = (id: string) => {
    if (pending) {
      return;
    }
    const next = models.find((option) => option.id === id);
    if (next && next.id !== settings.modelId) {
      change(settingsForModel(next, settings));
    }
  };
  const changeEffort = (value: string) => {
    if (pending) {
      return;
    }
    const effort = efforts.find((option) => option === value);
    if (effort && effort !== settings.reasoningEffort) {
      change({ ...settings, reasoningEffort: effort });
    }
  };
  const failedSettings = update.variables?.[agentRole];
  const retryable =
    failedSettings !== undefined &&
    modelSettingsSupported(failedSettings, models) &&
    !unavailable &&
    !isStaleError(update.error);

  return (
    <>
      <div
        aria-busy={pending}
        className="flex h-9 shrink-0 items-center gap-lg max-md:h-auto max-md:flex-wrap"
        data-testid={`${agentRole}-model-row`}
      >
        <span className="min-w-0 flex-1 text-sm leading-sm font-book tracking-tight text-text-secondary max-md:basis-full">
          {label}
        </span>
        <span className="sr-only" id={descriptionId}>
          {description}
        </span>
        <Select
          disabled={unavailable}
          onOpenChange={handleOpenChange}
          open={open}
          onValueChange={changeModel}
          value={settings.modelId}
        >
          <Hint disabled={open || pending} label={description}>
            <SelectTrigger
              appearance="model"
              aria-describedby={descriptionId}
              aria-label={`${label} model`}
              aria-disabled={unavailable || pending}
            >
              <SelectValue>{name}</SelectValue>
            </SelectTrigger>
          </Hint>
          <SelectContent appearance="model" aria-label={`${label} models`}>
            <SelectGroup appearance="model">
              <SelectLabel>{label}</SelectLabel>
              {models.map((option) => (
                <SelectItem
                  appearance="model"
                  key={option.id}
                  value={option.id}
                >
                  {option.displayName}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <ThinkingPicker
          description={description}
          descriptionId={descriptionId}
          disabled={unavailable}
          label={label}
          model={model}
          pending={pending}
          onValueChange={changeEffort}
          settings={settings}
        />
      </div>
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
  const unavailable =
    catalog.isPending ||
    catalog.isError ||
    catalog.data?.source !== "droid" ||
    models.length === 0;
  return (
    <PanelSection gap="xs" grow title="Models">
      <ModelRow
        agentRole="orchestrator"
        models={models}
        unavailable={unavailable}
      />
      <ModelRow agentRole="worker" models={models} unavailable={unavailable} />
      {catalog.isPending ? (
        <output className="text-xs leading-sm text-text-tertiary">
          Loading model catalog…
        </output>
      ) : null}
      {!catalog.isPending && unavailable ? (
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
            : "No models are available from Droid. Existing mission settings are unchanged."}
        </Callout>
      ) : null}
    </PanelSection>
  );
};
