import { z } from "zod";

export const IdSchema = z.string().min(1).max(128);
export const TimestampSchema = z.iso.datetime();
export const RevisionSchema = z.int().nonnegative();
/** Client-generated idempotency key for a mutating command. */
export const OperationIdSchema = z.string().min(8).max(128);

export const AutonomySchema = z.enum(["off", "low", "medium", "high"]);
export type Autonomy = z.infer<typeof AutonomySchema>;

export const RoleSchema = z.enum(["orchestrator", "worker"]);
export type Role = z.infer<typeof RoleSchema>;

/** Steer maps to native `end_of_turn`; Queue maps to native `end_of_loop`. */
export const DeliveryModeSchema = z.enum(["steer", "queue"]);
export type DeliveryMode = z.infer<typeof DeliveryModeSchema>;

export const ReasoningEffortSchema = z.enum([
  "none",
  "dynamic",
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;

export const PageSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
