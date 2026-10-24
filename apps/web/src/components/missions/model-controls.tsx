"use client";

import type { AgentModelSettings } from "@missions/protocol/missions";
import type { ModelOption } from "@missions/protocol/settings";
import { useId, useState } from "react";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Hint, HintTarget } from "@/components/ui/tooltip";
import { settingsForModel } from "@/lib/mission/model-settings";
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

/** Scope copy first, then whatever the live catalog says about the choice. */
const selectionDescription = (
  scope: string | undefined,
  model: ModelOption | undefined,
  settings: AgentModelSettings,
  unavailable: boolean
) => {
  const notes: string[] = scope ? [scope] : [];
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

const thinkingHint = (
  model: ModelOption | undefined,
  effortUnavailable: boolean
) => {
  if (!model) {
    return "Model unavailable";
  }
  if (model.supportedReasoningEfforts.length === 0) {
    return "No thinking levels";
  }
  return effortUnavailable ? "Level unavailable" : "";
};
const ThinkingPicker = ({
  descriptionId,
  disabled,
  label,
  model,
  pending,
  onValueChange,
  settings,
}: {
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
  const hint = thinkingHint(model, effortUnavailable);
  return (
    <Select
      disabled={disabled || !model || noEfforts}
      onValueChange={onValueChange}
      onOpenChange={handleOpenChange}
      open={open}
      value={settings.reasoningEffort ?? DEFAULT_EFFORT}
    >
      <Hint disabled={!hint || open || pending} label={hint}>
        <HintTarget inactive={disabled || !model || noEfforts}>
          <SelectTrigger
            appearance="thinking"
            aria-describedby={descriptionId}
            aria-label={`${label} thinking`}
            aria-disabled={disabled || !model || noEfforts || pending}
          >
            <span>Thinking</span>
            <SelectValue>{thinking}</SelectValue>
          </SelectTrigger>
        </HintTarget>
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

/**
 * GCL closed controls; KXE model menu; J48/J4O thinking menu. Controlled:
 * callers decide whether a change saves to a mission or stays in a draft.
 */
export const ModelControls = ({
  label,
  models,
  onChange,
  pending = false,
  scope,
  settings,
  showLabel = true,
  testId,
  unavailable,
}: {
  label: string;
  models: readonly ModelOption[];
  onChange: (next: AgentModelSettings) => void;
  pending?: boolean;
  scope?: string;
  settings: AgentModelSettings;
  showLabel?: boolean;
  testId: string;
  unavailable: boolean;
}) => {
  const descriptionId = useId();
  const { handleOpenChange, open } = useSavingSelect(pending);
  const model = models.find((option) => option.id === settings.modelId);
  const name = model?.displayName ?? settings.modelId;
  const efforts = model?.supportedReasoningEfforts ?? [];
  const description = selectionDescription(scope, model, settings, unavailable);
  const changeModel = (id: string) => {
    if (pending) {
      return;
    }
    const next = models.find((option) => option.id === id);
    if (next && next.id !== settings.modelId) {
      onChange(settingsForModel(next, settings));
    }
  };
  const changeEffort = (value: string) => {
    if (pending) {
      return;
    }
    const effort = efforts.find((option) => option === value);
    if (effort && effort !== settings.reasoningEffort) {
      onChange({ ...settings, reasoningEffort: effort });
    }
  };

  return (
    <div
      aria-busy={pending}
      className="flex h-9 shrink-0 items-center gap-lg max-md:h-auto max-md:flex-wrap"
      data-testid={testId}
    >
      {showLabel ? (
        <span className="min-w-0 flex-1 text-sm leading-sm font-book tracking-tight text-text-secondary max-md:basis-full">
          {label}
        </span>
      ) : null}
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
        <Hint
          disabled={(!unavailable && model !== undefined) || open || pending}
          label="Model unavailable"
        >
          <HintTarget inactive={unavailable}>
            <SelectTrigger
              appearance="model"
              aria-describedby={descriptionId}
              aria-label={`${label} model`}
              aria-disabled={unavailable || pending}
            >
              <SelectValue>{name}</SelectValue>
            </SelectTrigger>
          </HintTarget>
        </Hint>
        <SelectContent appearance="model" aria-label={`${label} models`}>
          <SelectGroup appearance="model">
            <SelectLabel>{label}</SelectLabel>
            {models.map((option) => (
              <SelectItem appearance="model" key={option.id} value={option.id}>
                {option.displayName}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <ThinkingPicker
        descriptionId={descriptionId}
        disabled={unavailable}
        label={label}
        model={model}
        pending={pending}
        onValueChange={changeEffort}
        settings={settings}
      />
    </div>
  );
};
