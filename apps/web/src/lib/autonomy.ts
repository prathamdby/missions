import type { Autonomy } from "@missions/protocol/common";

export const AUTONOMY_LEVELS: readonly Autonomy[] = [
  "off",
  "low",
  "medium",
  "high",
];

export const AUTONOMY: Record<Autonomy, { label: string; scope: string }> = {
  high: { label: "High", scope: "+ push, migrations, deploy" },
  low: { label: "Low", scope: "Edits + safe commands" },
  medium: { label: "Medium", scope: "+ installs, commits, builds" },
  off: { label: "Off", scope: "Reads only" },
};
