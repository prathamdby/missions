import type { AgentModelSettings } from "@missions/protocol/missions";
import type { ModelOption } from "@missions/protocol/settings";
import { describe, expect, it } from "vitest";

import {
  modelSettingsSupported,
  modelSettingsUpdate,
  settingsForModel,
} from "./model-settings";

const model: ModelOption = {
  defaultReasoningEffort: "medium",
  displayName: "Catalog model",
  id: "catalog-model",
  supportedReasoningEfforts: ["low", "medium"],
};
const current: AgentModelSettings = {
  modelId: "previous-model",
  reasoningEffort: "low",
};

describe("mission model choices", () => {
  it("preserves an effort supported by the selected model", () => {
    expect(settingsForModel(model, current)).toStrictEqual({
      modelId: model.id,
      reasoningEffort: "low",
    });
    expect(current.modelId).toBe("previous-model");
  });

  it.each(["high", null] as const)(
    "uses the selected model's default when the previous effort is %s",
    (reasoningEffort) => {
      expect(
        settingsForModel(model, { ...current, reasoningEffort })
      ).toStrictEqual({
        modelId: model.id,
        reasoningEffort: "medium",
      });
    }
  );

  it("uses null for models without reasoning, not an invented Off value", () => {
    expect(
      settingsForModel(
        {
          ...model,
          defaultReasoningEffort: null,
          supportedReasoningEfforts: [],
        },
        current
      )
    ).toStrictEqual({ modelId: model.id, reasoningEffort: null });
  });

  it("does not send an unsupported catalog default", () => {
    expect(
      settingsForModel(
        { ...model, defaultReasoningEffort: "high" },
        { ...current, reasoningEffort: "high" }
      ).reasoningEffort
    ).toBeNull();
  });

  it.each(["orchestrator", "worker"] as const)(
    "captures only the selected %s role and the visible revision",
    (agentRole) => {
      const next = settingsForModel(model, current);
      expect(modelSettingsUpdate(agentRole, next, 7)).toStrictEqual({
        [agentRole]: next,
        expectedRevision: 7,
      });
    }
  );

  it("allows a retry only for a currently offered model and supported effort", () => {
    expect(
      modelSettingsSupported({ modelId: model.id, reasoningEffort: "low" }, [
        model,
      ])
    ).toBeTruthy();
    expect(
      modelSettingsSupported({ modelId: model.id, reasoningEffort: null }, [
        model,
      ])
    ).toBeTruthy();
    expect(
      modelSettingsSupported({ modelId: model.id, reasoningEffort: "high" }, [
        model,
      ])
    ).toBeFalsy();
    expect(modelSettingsSupported(current, [model])).toBeFalsy();
    expect(modelSettingsSupported(current, [])).toBeFalsy();
  });
});
