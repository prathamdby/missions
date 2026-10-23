import type { AgentModelSettings } from "@missions/protocol/missions";
import type { ModelOption } from "@missions/protocol/settings";

export const DEFAULT_EFFORT = "__default__";

export const selectModel = (
  models: readonly ModelOption[],
  modelId: string
): AgentModelSettings => {
  const model = models.find((entry) => entry.id === modelId);
  const effort = model?.defaultReasoningEffort;
  return {
    modelId,
    reasoningEffort:
      effort && model.supportedReasoningEfforts.includes(effort)
        ? effort
        : null,
  };
};

export const selectEffort = (
  model: ModelOption | undefined,
  value: AgentModelSettings,
  effort: string
): AgentModelSettings => ({
  modelId: value.modelId,
  reasoningEffort:
    effort === DEFAULT_EFFORT
      ? null
      : (model?.supportedReasoningEfforts.find((entry) => entry === effort) ??
        value.reasoningEffort),
});

export const selectableModels = (
  models: readonly ModelOption[],
  value: AgentModelSettings
): readonly ModelOption[] =>
  models.some((model) => model.id === value.modelId)
    ? models
    : [
        {
          defaultReasoningEffort: null,
          displayName: value.modelId,
          id: value.modelId,
          supportedReasoningEfforts: [],
        },
        ...models,
      ];
