import type { TranscriptItem } from "@missions/protocol/missions";

const CLIP = 500;

const clip = (text: string) =>
  text.length > CLIP ? `${text.slice(0, CLIP)}…` : text;

/**
 * Fork carries the conversation through the chosen message as a new mission's
 * goal. It does not copy the source session, so the source stays unchanged.
 */
export const forkGoal = (
  items: readonly TranscriptItem[],
  throughId: string
): string | null => {
  const end = items.findIndex((item) => item.id === throughId);
  if (end === -1) {
    return null;
  }
  const kept = items
    .slice(0, end + 1)
    .filter((item) => item.kind === "user" || item.kind === "agent_message");
  const lines = [
    "[Missions] This mission continues an earlier conversation. The earlier mission is unchanged. Continue from the messages below and ask before acting if the latest intent is unclear.",
    "",
  ];
  for (const item of kept) {
    const who = item.kind === "user" ? "User" : (item.sender?.title ?? "Agent");
    lines.push(`- ${who}: ${clip(item.text)}`);
  }
  return lines.join("\n");
};

/** Hash target for a copied message link. */
export const messageAnchor = (itemId: string) => `m-${itemId}`;

export const messageLink = (
  origin: string,
  missionId: string,
  itemId: string
) => `${origin}/missions/${missionId}#${messageAnchor(itemId)}`;
