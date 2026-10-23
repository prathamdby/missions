"use client";

import type { AgentModelSettings } from "@missions/protocol/missions";
import type { ModelOption } from "@missions/protocol/settings";
import { CpuIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useModels } from "@/lib/api/queries";

export interface ModelChoice {
  orchestrator: AgentModelSettings;
  worker: AgentModelSettings;
}

const displayName = (models: readonly ModelOption[], id: string) =>
  models.find((model) => model.id === id)?.displayName ?? id;

const ModelRow = ({
  label,
  models,
  onChange,
  value,
}: {
  label: string;
  models: readonly ModelOption[];
  onChange: (value: AgentModelSettings) => void;
  value: AgentModelSettings;
}) => (
  <div className="flex items-center gap-md">
    <span className="w-24 shrink-0 type-caption text-text-secondary">
      {label}
    </span>
    <Select
      onValueChange={(id) => {
        const model = models.find((entry) => entry.id === id);
        onChange({
          modelId: id,
          reasoningEffort: model?.defaultReasoningEffort ?? null,
        });
      }}
      value={value.modelId}
    >
      <SelectTrigger aria-label={`${label} model`} className="min-w-0 flex-1">
        <SelectValue>{displayName(models, value.modelId)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {models.map((model) => (
          <SelectItem key={model.id} value={model.id}>
            {model.displayName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
);

/** Per-mission model override; defaults come from Settings. */
export const ModelPicker = ({
  onChange,
  value,
}: {
  onChange: (value: ModelChoice) => void;
  value: ModelChoice;
}) => {
  const models = useModels();
  const list = models.data?.models ?? [];
  const available = models.data?.source === "droid" && list.length > 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost">
          <CpuIcon aria-hidden="true" />
          <span className="hidden max-w-40 truncate md:inline">
            {displayName(list, value.orchestrator.modelId)}
          </span>
          <span className="sr-only md:hidden">Models</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top">
        <div className="flex flex-col gap-md p-lg">
          <p className="type-label text-text">Models for this mission</p>
          {available ? (
            <>
              <ModelRow
                label="Orchestrator"
                models={list}
                onChange={(orchestrator) =>
                  onChange({ ...value, orchestrator })
                }
                value={value.orchestrator}
              />
              <ModelRow
                label="Workers"
                models={list}
                onChange={(worker) => onChange({ ...value, worker })}
                value={value.worker}
              />
            </>
          ) : (
            <p className="type-caption text-text-secondary">
              Using your defaults: {value.orchestrator.modelId} plans,{" "}
              {value.worker.modelId} builds. The model list is unavailable right
              now.
            </p>
          )}
          <p className="type-caption text-text-tertiary">
            The Orchestrator plans and reviews. Workers build. Change defaults
            in Settings.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
};
