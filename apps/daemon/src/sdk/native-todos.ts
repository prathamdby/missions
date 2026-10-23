import { z } from "zod";

import type { TodoInput } from "./role-tools";

const TodoListSchema = z
  .array(
    z.object({
      content: z.string().trim().min(1),
      priority: z.enum(["high", "medium", "low"]).default("medium"),
      status: z.enum(["pending", "in_progress", "completed"]),
    })
  )
  .max(50);

const NUMBERED_TODO =
  /^\s*\d+\.\s*\[(?<status>pending|in_progress|completed)\]\s+(?<content>.+)$/u;

/** TodoWrite's numbered checklist, plus structured lists from SDK clients. */
export const nativeTodos = (
  input: Record<string, unknown>
): TodoInput[] | null => {
  let value = input.todos;
  if (typeof value === "string") {
    const lines = value.split("\n").filter((line) => line.trim().length > 0);
    const parsed = lines.map((line) => {
      const match = NUMBERED_TODO.exec(line);
      return match?.groups
        ? { content: match.groups.content, status: match.groups.status }
        : null;
    });
    value = parsed;
  }
  const result = TodoListSchema.safeParse(value);
  return result.success ? result.data : null;
};
