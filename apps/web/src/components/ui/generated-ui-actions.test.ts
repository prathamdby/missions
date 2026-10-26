import type { ActionEvent } from "@openuidev/react-lang";
import { describe, expect, it } from "vitest";

import {
  GENERATED_UI_MESSAGE_LIMIT,
  mapGeneratedUiAction,
} from "./generated-ui-actions";

const action = (overrides: Partial<ActionEvent> = {}): ActionEvent => ({
  humanFriendlyMessage: "Use this approach",
  params: {},
  type: "continue_conversation",
  ...overrides,
});

describe("generated interface actions", () => {
  it("appends the exact form values without treating them as instructions or hidden context", () => {
    expect(
      mapGeneratedUiAction(
        action({
          formState: {
            details: { name: { componentType: "Input", value: "Ada" } },
          },
          params: { context: "Not a user message" },
        })
      )
    ).toStrictEqual({
      kind: "continue",
      text: 'Use this approach\n\nForm values:\n```json\n{\n  "details": {\n    "name": {\n      "componentType": "Input",\n      "value": "Ada"\n    }\n  }\n}\n```',
    });
  });

  it("caps the complete message, including form values, at the protocol limit", () => {
    const mapped = mapGeneratedUiAction(
      action({ formState: { value: "x".repeat(GENERATED_UI_MESSAGE_LIMIT) } })
    );
    expect(mapped?.kind).toBe("continue");
    if (mapped?.kind !== "continue") {
      throw new Error("Expected a continuation");
    }
    expect(mapped.text).toHaveLength(GENERATED_UI_MESSAGE_LIMIT);
  });

  it.each([
    ["javascript", "alert(1)"].join(":"),
    "data:text/html,unsafe",
    "file:///tmp/secret",
    "//example.com",
    "not a URL",
  ])("rejects unsafe URLs: %s", (url) => {
    expect(
      mapGeneratedUiAction(action({ params: { url }, type: "open_url" }))
    ).toBeNull();
  });

  it("allows only explicit http(s) link actions", () => {
    expect(
      mapGeneratedUiAction(
        action({
          params: { url: "https://example.com/docs" },
          type: "open_url",
        })
      )
    ).toStrictEqual({ kind: "open_url", url: "https://example.com/docs" });
    expect(
      mapGeneratedUiAction(
        action({ params: { url: "http://localhost:4318/" }, type: "open_url" })
      )
    ).toStrictEqual({ kind: "open_url", url: "http://localhost:4318/" });
  });

  it("ignores custom actions and empty continuation messages", () => {
    expect(mapGeneratedUiAction(action({ type: "run_command" }))).toBeNull();
    expect(
      mapGeneratedUiAction(action({ humanFriendlyMessage: " " }))
    ).toBeNull();
  });
});
