"use client";

import type { AgentModelSettings } from "@missions/protocol/missions";

import { ModelCatalogNotice } from "@/components/missions/model-catalog-notice";
import { ModelControls } from "@/components/missions/model-controls";
import { Button } from "@/components/ui/button";
import { BrainIcon, ChevronDownIcon } from "@/components/ui/icons";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useModels } from "@/lib/api/queries";
import { catalogUnavailable } from "@/lib/mission/model-settings";

import type { ModelChoices } from "./mission-draft";

const SCOPE = {
  orchestrator:
    "Only this mission. Starts with your Settings default until you pick another.",
  worker:
    "Only this mission. Every Worker it starts uses this unless you change it later.",
} as const;

/** Composer chip that picks the Orchestrator and Worker models a mission starts with. */
export const ModelPicker = ({
  disabled = false,
  onChange,
  value,
}: {
  disabled?: boolean;
  onChange: (role: keyof ModelChoices, next: AgentModelSettings) => void;
  value: ModelChoices | null;
}) => {
  const catalog = useModels();
  const models = catalog.data?.models ?? [];
  const unavailable = catalogUnavailable(catalog);
  const current = value?.orchestrator;
  const name = current
    ? (models.find((option) => option.id === current.modelId)?.displayName ??
      current.modelId)
    : "Models";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          aria-label={`Models: ${name}`}
          data-testid="model-picker"
          disabled={disabled || value === null}
          size="chip"
          variant="chip"
        >
          <BrainIcon size="sm" tone="secondary" />
          <span className="max-w-48 truncate font-medium text-text-secondary max-md:hidden">
            {name}
          </span>
          <ChevronDownIcon size="xs" tone="tertiary" />
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label="Mission models" side="top" size="lg">
        <div className="flex flex-col gap-xs px-md pb-md">
          <p className="pt-sm pb-xs text-xs leading-sm font-medium tracking-tight text-text-tertiary">
            Models · this mission only
          </p>
          {value ? (
            <>
              <ModelControls
                label="Orchestrator"
                models={models}
                onChange={(next) => onChange("orchestrator", next)}
                scope={SCOPE.orchestrator}
                settings={value.orchestrator}
                testId="new-orchestrator-model-row"
                unavailable={unavailable}
              />
              <ModelControls
                label="Workers"
                models={models}
                onChange={(next) => onChange("worker", next)}
                scope={SCOPE.worker}
                settings={value.worker}
                testId="new-worker-model-row"
                unavailable={unavailable}
              />
            </>
          ) : null}
          <ModelCatalogNotice
            catalog={catalog}
            unchanged="Your current choices are kept."
          />
        </div>
      </PopoverContent>
    </Popover>
  );
};
