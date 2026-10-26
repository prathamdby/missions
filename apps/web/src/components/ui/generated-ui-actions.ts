"use client";

import type { ActionEvent } from "@openuidev/react-lang";
import { createContext } from "react";

export const GENERATED_UI_MESSAGE_LIMIT = 100_000;

export const GeneratedUiActionsContext = createContext<{
  disabledReason: string | null;
  onContinue: (text: string, occurrence: string) => Promise<boolean>;
} | null>(null);

export const GeneratedUiBlockContext = createContext<string | null>(
  "This interface is read-only"
);

export const generatedUiUrl = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
};

export const mapGeneratedUiAction = (event: ActionEvent) => {
  if (event.type === "open_url") {
    const url = generatedUiUrl(event.params.url);
    return url ? { kind: "open_url" as const, url } : null;
  }
  if (event.type !== "continue_conversation") {
    return null;
  }
  const values =
    event.formState && Object.keys(event.formState).length > 0
      ? `\n\nForm values:\n\`\`\`json\n${JSON.stringify(event.formState, null, 2)}\n\`\`\``
      : "";
  const text = `${event.humanFriendlyMessage}${values}`
    .slice(0, GENERATED_UI_MESSAGE_LIMIT)
    .trim();
  return text ? { kind: "continue" as const, text } : null;
};
