import { CreateMissionRequestSchema } from "@missions/protocol/commands";
import type { TranscriptItem } from "@missions/protocol/missions";

const CLIP = 500;
const GOAL_LIMIT = CreateMissionRequestSchema.shape.goal.maxLength ?? 20_000;

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
  const ordered = items.toSorted((left, right) => left.seq - right.seq);
  const end = ordered.findIndex((item) => item.id === throughId);
  if (end === -1) {
    return null;
  }
  const kept = ordered
    .slice(0, end + 1)
    .filter((item) => item.kind === "user" || item.kind === "agent_message");
  const intro =
    "[Missions] This mission continues an earlier conversation. The earlier mission is unchanged. Continue from the messages below and ask before acting if the latest intent is unclear.";
  const lines = kept.map((item) => {
    const who = item.kind === "user" ? "User" : (item.sender?.title ?? "Agent");
    return `- ${who}: ${clip(item.text)}`;
  });
  // A goal the form accepts has to be one the server accepts, so the newest
  // lines stay and earlier ones drop once the limit is reached.
  const keptLines: string[] = [];
  for (const line of lines.toReversed()) {
    const next = [intro, "", ...keptLines.toReversed(), line].join("\n");
    if (next.length > GOAL_LIMIT) {
      break;
    }
    keptLines.push(line);
  }
  const shown = keptLines.toReversed();
  const omitted = lines.length - shown.length;
  const head = [intro];
  if (omitted > 0) {
    head.push(
      `${omitted} earlier ${omitted === 1 ? "message" : "messages"} omitted to fit.`
    );
  }
  return [...head, "", ...shown].join("\n");
};

/** Hash target for a copied message link. */
export const messageAnchor = (itemId: string) => `m-${itemId}`;

export const messageLink = (
  origin: string,
  missionId: string,
  itemId: string
) => `${origin}/missions/${missionId}#${messageAnchor(itemId)}`;
