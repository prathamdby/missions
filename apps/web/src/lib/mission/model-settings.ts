import type { UpdateMissionRequest } from "@missions/protocol/commands";
import type { AgentModelSettings } from "@missions/protocol/missions";
import type { ModelList, ModelOption } from "@missions/protocol/settings";

export type ModelRole = "orchestrator" | "worker";

/** Preserve a supported preference; never carry an invalid effort to a new model. */
export const settingsForModel = (
  model: ModelOption,
  current: AgentModelSettings
): AgentModelSettings => {
  const supported = model.supportedReasoningEfforts;
  let { reasoningEffort } = current;
  if (reasoningEffort === null || !supported.includes(reasoningEffort)) {
    const fallback = model.defaultReasoningEffort;
    reasoningEffort =
      fallback !== null && supported.includes(fallback) ? fallback : null;
  }
  return { modelId: model.id, reasoningEffort };
};

/** PATCH only the requested role, using the revision visible at the interaction. */
export const modelSettingsUpdate = (
  role: ModelRole,
  settings: AgentModelSettings,
  expectedRevision: number
): UpdateMissionRequest =>
  role === "orchestrator"
    ? { expectedRevision, orchestrator: settings }
    : { expectedRevision, worker: settings };

/** Choices stay visible but cannot change until Droid's live catalog lists models. */
export const catalogUnavailable = (catalog: {
  data?: ModelList;
  isError: boolean;
  isPending: boolean;
}) =>
  catalog.isPending ||
  catalog.isError ||
  catalog.data?.source !== "droid" ||
  catalog.data.models.length === 0;

export const modelSettingsSupported = (
  settings: AgentModelSettings,
  models: readonly ModelOption[]
) => {
  const model = models.find((option) => option.id === settings.modelId);
  return (
    model !== undefined &&
    (settings.reasoningEffort === null ||
      model.supportedReasoningEfforts.includes(settings.reasoningEffort))
  );
};
